import { randomBytes, randomUUID } from 'node:crypto';
import { PublicError, receipt } from './domain.mjs';
import { encryptRecord, decryptRecord } from './encryption.mjs';

export class PostgresStore {
  constructor(pool, secret) { this.pool = pool; this.secret = secret; }
  async transaction(fn) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SET LOCAL lock_timeout = '3s'");
      await client.query("SET LOCAL statement_timeout = '5s'");
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  }
  async acquire(id, create) {
    const owner = randomUUID();
    const result = await this.pool.query(
      "UPDATE quori_sessions SET lease_owner=$2, lease_until=clock_timestamp()+interval '45 seconds' WHERE id=$1 AND expires_at>clock_timestamp() AND (lease_until IS NULL OR lease_until<clock_timestamp()) RETURNING data",
      [id, owner]);
    if (result.rows.length) {
      try { return { id, owner, data: decryptRecord(result.rows[0].data, this.secret, 'session:' + id) }; }
      catch (error) { await this.release({ id, owner }); throw error; }
    }
    const existing = await this.pool.query('SELECT expires_at>clock_timestamp() AS alive FROM quori_sessions WHERE id=$1', [id]);
    if (existing.rows[0]?.alive) throw new PublicError(429, 'Quori is still completing your previous request. Please try again shortly.', 2);
    if (!create) throw new PublicError(403, 'Session expired. Close and reopen Quori to reconnect.');
    const fresh = randomBytes(32).toString('hex');
    const data = { token: randomBytes(32).toString('hex'), conversation: randomBytes(16).toString('hex'),
      history: [], requests: {}, callback_ids: [] };
    await this.pool.query(
      "INSERT INTO quori_sessions(id,data,expires_at,lease_owner,lease_until) VALUES($1,$2,clock_timestamp()+interval '30 minutes',$3,clock_timestamp()+interval '45 seconds')",
      [fresh, encryptRecord(data, this.secret, 'session:' + fresh), owner]);
    return { id: fresh, owner, data, fresh: true };
  }
  async save(session) {
    const result = await this.pool.query(
      "UPDATE quori_sessions SET data=$3, expires_at=clock_timestamp()+interval '30 minutes' WHERE id=$1 AND lease_owner=$2 AND lease_until>clock_timestamp() RETURNING id",
      [session.id, session.owner, encryptRecord(session.data, this.secret, 'session:' + session.id)]);
    if (!result.rows.length) throw new Error('Session lease expired');
  }
  async renew(session) {
    const result = await this.pool.query(
      "UPDATE quori_sessions SET lease_until=clock_timestamp()+interval '45 seconds' WHERE id=$1 AND lease_owner=$2 AND lease_until>clock_timestamp() RETURNING id",
      [session.id, session.owner]);
    if (!result.rows.length) throw new Error('Session lease expired');
  }
  async release(session) {
    await this.pool.query('UPDATE quori_sessions SET lease_owner=NULL, lease_until=NULL WHERE id=$1 AND lease_owner=$2', [session.id, session.owner]);
  }
  async rateWithin(client, ip, limits) {
    await client.query("INSERT INTO quori_usage(day,total,ips) VALUES((now() AT TIME ZONE 'UTC')::date,0,'{}') ON CONFLICT DO NOTHING");
    const { rows } = await client.query("SELECT day::text,total,ips,extract(epoch from now())::double precision AS now FROM quori_usage WHERE day=(now() AT TIME ZONE 'UTC')::date FOR UPDATE");
    const row = rows[0], ips = {};
    for (const [key, times] of Object.entries(row.ips)) {
      const recent = times.filter(time => time > row.now - 3600);
      if (recent.length) ips[key] = recent;
    }
    const times = ips[ip] || [];
    if (row.total >= limits.day || times.length >= limits.hour || times.filter(time => time > row.now - 60).length >= limits.minute)
      throw new PublicError(429, 'Quori has reached a usage limit. Please try later or contact the team.', 60);
    ips[ip] = [...times, row.now];
    await client.query('UPDATE quori_usage SET total=total+1,ips=$2 WHERE day=$1', [row.day, JSON.stringify(ips)]);
  }
  async consumeRate(ip, limits) { return this.transaction(client => this.rateWithin(client, ip, limits)); }
  async claimCallback(session, id, digest, event, ip, limits) {
    return this.transaction(async client => {
      const locked = await client.query('SELECT data FROM quori_sessions WHERE id=$1 AND lease_owner=$2 AND lease_until>clock_timestamp() FOR UPDATE', [session.id, session.owner]);
      if (!locked.rows.length) throw new Error('Session lease expired');
      const { rows } = await client.query('SELECT * FROM quori_callbacks WHERE id=$1 FOR UPDATE', [id]);
      const job = rows[0];
      if (job && job.digest !== digest) throw new PublicError(409, 'These details changed after submission. Start a new request to send different details.');
      if (job && job.status !== 'failed') return { send: false, result: receipt(id, job.status) };
      if (!job && session.data.callback_ids.length >= 3) throw new PublicError(429, 'You have already submitted several requests. Please contact the team directly.');
      await this.rateWithin(client, ip, limits);
      if (!job) {
        await client.query("INSERT INTO quori_callbacks(id,conversation,digest,status,event) VALUES($1,$2,$3,'sending',$4)",
          [id, session.data.conversation, digest, encryptRecord(event, this.secret, 'callback:' + id)]);
        session.data.callback_ids.push(id);
        await client.query('UPDATE quori_sessions SET data=$3 WHERE id=$1 AND lease_owner=$2',
          [session.id, session.owner, encryptRecord(session.data, this.secret, 'session:' + session.id)]);
      } else await client.query("UPDATE quori_callbacks SET status='sending' WHERE id=$1", [id]);
      return { send: true, event: job?.event ? decryptRecord(job.event, this.secret, 'callback:' + id) : event };
    });
  }
  async finishCallback(id, status) {
    await this.pool.query("UPDATE quori_callbacks SET status=$2,event=CASE WHEN $2='accepted' THEN NULL ELSE event END WHERE id=$1", [id, status]);
  }
  async lastReceipt(conversation) {
    const { rows } = await this.pool.query('SELECT id,status FROM quori_callbacks WHERE conversation=$1 ORDER BY created_at DESC LIMIT 1', [conversation]);
    return rows.length ? receipt(rows[0].id, rows[0].status) : null;
  }
  async cleanup() {
    await this.transaction(async client => {
      await client.query('DELETE FROM quori_sessions WHERE expires_at<now() AND (lease_until IS NULL OR lease_until<now())');
      await client.query("DELETE FROM quori_callbacks WHERE created_at<now()-interval '7 days'");
      await client.query("DELETE FROM quori_usage WHERE day<(now() AT TIME ZONE 'UTC')::date");
    });
  }
}
