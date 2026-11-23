const HOST_ID = 'figvam-e2e-demo-overlay';

function createDemo(page, totalSteps, options = {}) {
  const enabled = options.enabled ?? (process.env.FIGVAM_DEMO === '1');
  const stepDelayMs = Number(options.stepDelayMs ?? process.env.FIGVAM_STEP_DELAY_MS ?? 2000);
  if (!Number.isInteger(totalSteps) || totalSteps < 1)
    throw new Error('totalSteps must be a positive integer');
  if (!Number.isInteger(stepDelayMs) || stepDelayMs < 0)
    throw new Error('FIGVAM_STEP_DELAY_MS must be a non-negative integer');

  let current = 0;
  return {
    async step(title, description = '', targetPage = page) {
      if (!enabled) return;
      current++;
      if (current > totalSteps) throw new Error('Demo step count exceeds totalSteps');

      await targetPage.evaluate(({ hostId, title, description, current, totalSteps }) => {
        let host = document.getElementById(hostId);
        if (!host) {
          host = document.createElement('div');
          host.id = hostId;
          host.style.cssText = 'position:fixed;bottom:12px;left:50%;transform:translateX(-50%);' +
            'width:min(480px,calc(100vw - 24px));z-index:2147483647;pointer-events:none;';
          // Mount last in body so the panel remains above the editor without modifying its layout.
          (document.body ?? document.documentElement).appendChild(host);
          // The editor's CSP has style-src 'self'. Inline <style> inside Shadow DOM
          // is blocked on real pages; CSSOM property assignment is permitted.
          const shadow = host.attachShadow({ mode: 'open' });
          shadow.innerHTML = [
            '<section class="panel" role="status" aria-live="polite">',
            '<div class="top"><span>FigVam · UI demo</span><span class="counter"></span></div>',
            '<div class="title"></div><div class="description"></div>',
            '<div class="track"><div class="progress"></div></div>',
            '</section>'
          ].join('');

          const applyStyle = (selector, properties) => {
            const element = shadow.querySelector(selector);
            for (const [property, value] of Object.entries(properties))
              element.style[property] = value;
          };
          applyStyle('.panel', {
            boxSizing: 'border-box', margin: '0', padding: '9px 13px 8px',
            borderRadius: '9px', backgroundColor: 'rgba(12, 18, 30, 0.92)',
            color: '#fff', boxShadow: '0 8px 28px rgba(0, 0, 0, 0.5)',
            fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
            border: '1px solid rgba(255, 255, 255, 0.3)',
            textAlign: 'left', lineHeight: '1.2',
            backdropFilter: 'blur(12px)', webkitBackdropFilter: 'blur(12px)'
          });
          applyStyle('.top', {
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            margin: '0 0 4px', fontSize: '10px', lineHeight: '1.1', color: '#d4dceb'
          });
          applyStyle('.title', {
            margin: '0', fontSize: '15px', lineHeight: '1.2', fontWeight: '600'
          });
          applyStyle('.description', {
            margin: '3px 0 0', fontSize: '12px', lineHeight: '1.25',
            color: '#e1e8f2'
          });
          applyStyle('.track', {
            height: '3px', margin: '7px 0 0',
            backgroundColor: 'rgba(255, 255, 255, 0.15)',
            borderRadius: '4px', overflow: 'hidden'
          });
          applyStyle('.progress', {
            height: '100%', backgroundColor: '#70a8ff'
          });
        }
        const shadow = host.shadowRoot;
        shadow.querySelector('.counter').textContent = 'Шаг ' + current + ' из ' + totalSteps;
        shadow.querySelector('.title').textContent = title;
        const details = shadow.querySelector('.description');
        details.textContent = description;
        details.hidden = !description;
        shadow.querySelector('.progress').style.width =
          String(Math.round(100 * current / totalSteps)) + '%';
      }, { hostId: HOST_ID, title, description, current, totalSteps });

      // Only presentation mode waits. Ordinary CI runs have no extra delays.
      if (stepDelayMs) await targetPage.waitForTimeout(stepDelayMs);
    }
  };
}

module.exports = { createDemo, HOST_ID };
