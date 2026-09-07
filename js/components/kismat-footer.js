// KismatFooter — global footer badge rendered across all Xpensic pages.
// A centered glassmorphism pill linking to Kismat Studio. Mounts itself
// into the provided container (defaults to #kismat-footer).
export function KismatFooter(container) {
  const host = container || document.getElementById("kismat-footer");
  if (!host) return;
  host.innerHTML = `
    <a href="https://www.kismatstudio.com" target="_blank" rel="noopener" class="kismat-footer" aria-label="Built at Kismat Studio">
      <span class="kismat-pill">
        <img src="assets/brand/ks-logo.png" alt="Kismat Studio" class="kismat-logo" />
        <span class="kismat-text">Built at Kismat Studio</span>
      </span>
    </a>`;
}
