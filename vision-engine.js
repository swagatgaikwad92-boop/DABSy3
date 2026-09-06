/* ============================================================
   D.A.B.S.y — vision-engine.js
   Camera + screen capture -> single frame as base64, for sending
   to Gemini's vision-capable endpoint. Kept minimal on purpose:
   permission is requested only when actually needed, never on load.
   ============================================================ */

(function(){
  const bus = window.DABSy.bus;
  let videoEl = null;
  let stream = null;

  function ensureVideoEl(){
    if(videoEl) return videoEl;
    videoEl = document.createElement("video");
    videoEl.style.display = "none";
    videoEl.playsInline = true;
    videoEl.muted = true;
    document.body.appendChild(videoEl);
    return videoEl;
  }

  async function captureFrom(mediaStream){
    const v = ensureVideoEl();
    v.srcObject = mediaStream;
    await v.play();
    await new Promise(r=>setTimeout(r, 200)); // let a frame land
    const canvas = document.createElement("canvas");
    canvas.width = v.videoWidth || 640;
    canvas.height = v.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
    return dataUrl.split(",")[1]; // base64 payload only
  }

  async function captureCameraFrame(){
    try{
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      const b64 = await captureFrom(stream);
      stopStream();
      bus.emit("vision:frame", { source: "camera", base64: b64 });
      return b64;
    }catch(e){
      bus.emit("vision:error", { source:"camera", error: e });
      return null;
    }
  }

  async function captureScreenFrame(){
    try{
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      const b64 = await captureFrom(stream);
      stopStream();
      bus.emit("vision:frame", { source: "screen", base64: b64 });
      return b64;
    }catch(e){
      bus.emit("vision:error", { source:"screen", error: e });
      return null;
    }
  }

  function stopStream(){
    if(stream){ stream.getTracks().forEach(t=>t.stop()); stream = null; }
  }

  window.DABSy = window.DABSy || {};
  window.DABSy.vision = { captureCameraFrame, captureScreenFrame, stopStream };
})();
