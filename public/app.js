const form = document.getElementById('uploadForm');
const in1 = document.getElementById('in1');
const in2 = document.getElementById('in2');
const p1 = document.getElementById('p1');
const p2 = document.getElementById('p2');
const status = document.getElementById('status');
const result = document.getElementById('result');
const clear = document.getElementById('clear');

function preview(fileInput, imgEl) {
  const f = fileInput.files[0];
  if (!f) { imgEl.src = ''; return; }
  const url = URL.createObjectURL(f);
  imgEl.src = url;
}

in1.addEventListener('change', () => preview(in1, p1));
in2.addEventListener('change', () => preview(in2, p2));

clear.addEventListener('click', () => {
  in1.value = '';
  in2.value = '';
  p1.src = '';
  p2.src = '';
  result.innerHTML = '';
  status.textContent = '';
});

form.addEventListener('submit', async (e) => {
  e.preventDefault();
  status.textContent = 'Running... (this may take a while)';
  result.innerHTML = '';

  const fd = new FormData();
  fd.append('in1', in1.files[0]);
  fd.append('in2', in2.files[0]);

  try {
    const resp = await fetch('/run', { method: 'POST', body: fd });
    const data = await resp.json();
    if (!data.ok) {
      status.textContent = 'Error: ' + (data.error || 'unknown');
      return;
    }

    status.textContent = 'Done';
    const res = data.result || {};
    const url = res.generatedImageUrl || (res.result && res.result.generatedImageUrl) || '';
    const desc = res.description || '';

    result.innerHTML = `
      <div><strong>Description:</strong> ${desc}</div>
      <div><strong>generatedImageUrl:</strong> <a href="${url}" target="_blank">${url}</a></div>
      ${url ? `<img src="${url}" alt="generated"/>` : ''}
    `;
  } catch (err) {
    status.textContent = 'Request failed: ' + err.message;
  }
});
