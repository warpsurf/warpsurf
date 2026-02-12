// Auto-request microphone permission on load
(async () => {
  const status = document.getElementById('status');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach(t => t.stop());
    status.textContent = '✓ Microphone access granted';
    status.className = 'success';
    setTimeout(() => window.close(), 1000);
  } catch (err) {
    if (err.name === 'NotAllowedError') {
      status.textContent = 'Permission denied. Please allow access in browser settings.';
    } else if (err.name === 'NotFoundError') {
      status.textContent = 'No microphone found. Please connect one and try again.';
    } else {
      status.textContent = 'Failed to access microphone.';
    }
    status.className = 'error';
  }
})();
