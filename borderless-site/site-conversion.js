// Anonymous, best-effort tracking of real Buy clicks. No page slowdown.
(() => {
  const buy = document.getElementById('buy');
  if (!buy) return;
  buy.addEventListener('click', () => {
    if (!buy.getAttribute('href') || buy.getAttribute('aria-disabled') === 'true') return;
    try {
      const url = 'https://checkout.borderlesstheory.com/api/conversion-event';
      const payload = JSON.stringify({kind:'buy_click', event_id:crypto.randomUUID()});
      const body = new Blob([payload], {type:'text/plain;charset=UTF-8'});
      if (navigator.sendBeacon?.(url, body)) return;
      fetch(url, {method:'POST',body,mode:'cors',credentials:'omit',keepalive:true}).catch(()=>{});
    } catch (_) { /* Tracking must not interfere with Buy. */ }
  }, {passive:true});
})();
