// QR import runs entirely in the browser: the image is decoded to an
// otpauth:// URI here, and only the resulting fields are submitted.
(() => {
  const form = document.getElementById("entry-form");
  if (!form) return;

  const fileInput = document.getElementById("qr-file");
  const cameraBtn = document.getElementById("qr-camera");
  const video = document.getElementById("qr-video");
  const status = document.getElementById("qr-status");
  const pasteInput = document.getElementById("otpauth-input");
  const pasteApply = document.getElementById("otpauth-apply");

  const say = (message) => {
    if (status) status.textContent = message;
  };

  const fields = {
    issuer: document.getElementById("f-issuer"),
    label: document.getElementById("f-label"),
    account: document.getElementById("f-account"),
    secret: document.getElementById("f-secret"),
    algorithm: document.getElementById("f-algorithm"),
    digits: document.getElementById("f-digits"),
    period: document.getElementById("f-period"),
  };

  const applyUri = (uri) => {
    let url;
    try {
      url = new URL(uri.trim());
    } catch {
      say("URI tidak valid.");
      return false;
    }
    if (url.protocol !== "otpauth:" || url.host.toLowerCase() !== "totp") {
      say("Hanya otpauth TOTP yang didukung.");
      return false;
    }
    const params = url.searchParams;
    const secret = (params.get("secret") || "").replace(/\s/g, "").toUpperCase();
    if (!/^[A-Z2-7]+=*$/.test(secret)) {
      say("Secret di QR tidak valid.");
      return false;
    }
    const rawLabel = decodeURIComponent(url.pathname.replace(/^\//, ""));
    const issuerParam = params.get("issuer") || "";
    const parts = rawLabel.includes(":") ? rawLabel.split(":") : [issuerParam, rawLabel];
    const issuer = (issuerParam || parts[0] || "").trim();
    const account = (parts.length > 1 ? parts.slice(1).join(":") : rawLabel).trim();
    const algorithm = (params.get("algorithm") || "SHA1").toUpperCase();
    const digits = params.get("digits") === "8" ? "8" : "6";
    const periodRaw = Number(params.get("period") || "30");
    const period = Number.isFinite(periodRaw) && periodRaw >= 10 && periodRaw <= 300 ? periodRaw : 30;

    if (fields.secret) fields.secret.value = secret;
    if (fields.issuer) fields.issuer.value = issuer;
    if (fields.account) fields.account.value = account;
    if (fields.label) fields.label.value = issuer || account || "Tanpa nama";
    if (fields.algorithm) fields.algorithm.value = ["SHA1", "SHA256", "SHA512"].includes(algorithm) ? algorithm : "SHA1";
    if (fields.digits) fields.digits.value = digits;
    if (fields.period) fields.period.value = String(period);

    say(`Terisi: ${issuer || account || "kunci"}`);
    if (fields.secret) fields.secret.focus();
    return true;
  };

  const decodeImage = (image) => {
    const canvas = document.createElement("canvas");
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const result = window.jsQR ? window.jsQR(pixels.data, pixels.width, pixels.height) : null;
    return result && result.data ? result.data : null;
  };

  if (fileInput) {
    fileInput.addEventListener("change", () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      if (!window.jsQR) {
        say("Decoder QR belum siap, coba lagi.");
        return;
      }
      say("Membaca gambar…");
      const image = new Image();
      image.onload = () => {
        const data = decodeImage(image);
        URL.revokeObjectURL(image.src);
        if (!data) {
          say("QR tidak terbaca. Coba gambar yang lebih tajam.");
          return;
        }
        applyUri(data);
      };
      image.onerror = () => say("Gagal membuka gambar.");
      image.src = URL.createObjectURL(file);
    });
  }

  let stream = null;
  const stopCamera = () => {
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      stream = null;
    }
    if (video) video.hidden = true;
  };

  if (cameraBtn && video) {
    cameraBtn.addEventListener("click", async () => {
      if (stream) {
        stopCamera();
        say("Kamera dimatikan.");
        return;
      }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        say("Browser tidak mendukung kamera, atau halaman tidak di HTTPS.");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
      } catch {
        say("Izin kamera ditolak.");
        return;
      }
      video.srcObject = stream;
      video.hidden = false;
      await video.play();
      say("Arahkan kamera ke QR…");

      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d", { willReadFrequently: true });
      let scanning = true;
      const scan = () => {
        if (!scanning || !context || !window.jsQR) return;
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
          const found = window.jsQR(pixels.data, pixels.width, pixels.height);
          if (found && found.data) {
            scanning = false;
            stopCamera();
            applyUri(found.data);
            return;
          }
        }
        requestAnimationFrame(scan);
      };
      requestAnimationFrame(scan);
    });
  }

  if (pasteApply && pasteInput) {
    pasteApply.addEventListener("click", () => {
      if (applyUri(pasteInput.value)) pasteInput.value = "";
    });
    pasteInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        pasteApply.click();
      }
    });
  }

  window.addEventListener("pagehide", stopCamera);
})();
