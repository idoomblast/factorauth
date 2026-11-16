// Drag and drop for the xlsx import upload. Progressive enhancement only:
// without this file the plain file input inside the dropzone still works.
(() => {
  const form = document.getElementById("import-form");
  if (!form) return;

  const input = document.getElementById("import-file");
  const zone = document.getElementById("dropzone");
  const title = document.getElementById("dz-title");
  const sub = document.getElementById("dz-sub");
  const fileLabel = document.getElementById("dz-file");
  const errorBox = document.getElementById("dz-error");
  const submit = document.getElementById("import-submit");
  if (!input || !zone || !title || !sub || !fileLabel || !errorBox) return;

  const MAX_BYTES = 4 * 1024 * 1024;
  const defaultTitle = title.textContent;
  const defaultSub = sub.innerHTML;

  const humanSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const setError = (message) => {
    errorBox.textContent = message;
    errorBox.hidden = !message;
  };

  const reset = () => {
    zone.classList.remove("has-file");
    title.textContent = defaultTitle;
    sub.innerHTML = defaultSub;
    fileLabel.hidden = true;
    fileLabel.textContent = "";
    if (submit) submit.setAttribute("disabled", "");
  };

  const accept = (file) => {
    if (!file) {
      reset();
      return;
    }
    if (!/\.xlsx$/i.test(file.name)) {
      input.value = "";
      reset();
      setError("Hanya file .xlsx yang bisa diimpor.");
      return;
    }
    if (file.size > MAX_BYTES) {
      input.value = "";
      reset();
      setError(`File ${humanSize(file.size)}, batasnya 4 MB.`);
      return;
    }
    setError("");
    zone.classList.add("has-file");
    title.textContent = file.name;
    sub.textContent = "Klik untuk ganti file";
    fileLabel.textContent = `${humanSize(file.size)} · siap dibaca`;
    fileLabel.hidden = false;
    if (submit) submit.removeAttribute("disabled");
  };

  input.addEventListener("change", () => accept(input.files && input.files[0]));

  let dragDepth = 0;
  const isFileDrag = (event) => Array.from(event.dataTransfer?.types ?? []).includes("Files");

  zone.addEventListener("dragenter", (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragDepth += 1;
    zone.classList.add("is-dragover");
  });

  zone.addEventListener("dragover", (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    // Some browsers report dragover before dragenter when the pointer moves fast.
    dragDepth = Math.max(dragDepth, 1);
    zone.classList.add("is-dragover");
  });

  zone.addEventListener("dragleave", (event) => {
    if (!isFileDrag(event)) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) zone.classList.remove("is-dragover");
  });

  zone.addEventListener("drop", (event) => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    dragDepth = 0;
    zone.classList.remove("is-dragover");
    const dropped = event.dataTransfer.files;
    if (!dropped || dropped.length === 0) return;
    const transfer = new DataTransfer();
    transfer.items.add(dropped[0]);
    input.files = transfer.files;
    accept(input.files[0]);
  });

  // Dropping a file outside the zone must not navigate the tab to the file.
  for (const type of ["dragover", "drop"]) {
    window.addEventListener(type, (event) => {
      if (isFileDrag(event) && !zone.contains(event.target)) event.preventDefault();
    });
  }

  form.addEventListener("submit", (event) => {
    if (!input.files || input.files.length === 0) {
      event.preventDefault();
      setError("Pilih atau tarik file .xlsx dulu.");
      return;
    }
    if (submit) {
      submit.setAttribute("disabled", "");
      submit.textContent = "Membaca file…";
    }
  });

  reset();
})();
