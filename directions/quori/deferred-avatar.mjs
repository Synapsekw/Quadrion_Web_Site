// Hold UI state while the optional 3D renderer loads. Chat never waits for WebGL.
export function deferAvatar(create, onError = () => {}) {
  let instance, pending, destroyed = false;
  let state = 'idle', motion = true, visible = true;
  return {
    load() {
      if (destroyed) return Promise.resolve();
      if (!pending) {
        try {
          pending = Promise.resolve(create()).then(value => {
            if (destroyed) { value.destroy(); return; }
            instance = value;
            instance.setMotion(motion); instance.setVisible(visible); instance.setState(state);
          }).catch(onError);
        } catch (error) { pending = Promise.resolve(); onError(error); }
      }
      return pending;
    },
    setState(value) { state = value; if (!destroyed) instance?.setState(value); },
    setMotion(value) { motion = !!value; if (!destroyed) instance?.setMotion(motion); },
    setVisible(value) { visible = !!value; if (!destroyed) instance?.setVisible(visible); },
    play(value) { if (!destroyed && motion) instance?.play(value); },
    destroy() { if (destroyed) return; destroyed = true; instance?.destroy(); },
  };
}
