/* Google Consent Mode v2 for the public site. Load synchronously before gtag.js. */
(() => {
  const STORAGE_KEY = 'wampums.landing.consent';
  const STORAGE_VERSION = 1;
  const CONSENT_DAYS = 180;
  const DAY_MS = 86_400_000;
  const CONSENT_MAX_AGE_MS = CONSENT_DAYS * DAY_MS;
  const DENIED = {
    analytics_storage: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
  };
  const COPY = {
    en: {
      title: 'Your cookie choices',
      explanation: 'With your permission, we use Google Analytics cookies to understand visits and improve Wampums. Advertising cookies stay disabled.',
      details: 'Google receives limited measurements without cookies until you accept. We remember your choice on this device for {days} days. You can change it in Cookie settings.',
      accept: 'Allow analytics cookies',
      reject: 'Reject analytics cookies',
      settings: 'Cookie settings',
      privacy: 'Google privacy policy',
      saved: 'Your cookie choice has been saved.',
      notSaved: 'Your choice applies to this page. Your browser could not save it, so you may be asked again on your next visit.',
    },
    fr: {
      title: 'Vos choix de témoins',
      explanation: 'Avec votre accord, nous utilisons les témoins de Google Analytics pour comprendre les visites et améliorer Wampums. Les témoins publicitaires restent désactivés.',
      details: 'Google reçoit des mesures limitées sans témoins tant que vous refusez ou ne choisissez pas. Nous conservons votre choix sur cet appareil pendant {days} jours. Vous pouvez le modifier dans les paramètres des témoins.',
      accept: 'Accepter les témoins statistiques',
      reject: 'Refuser les témoins statistiques',
      settings: 'Paramètres des témoins',
      privacy: 'Politique de confidentialité de Google',
      saved: 'Votre choix de témoins a été enregistré.',
      notSaved: 'Votre choix est appliqué à cette page. Votre navigateur ne peut pas le conserver; il pourrait vous être demandé à votre prochaine visite.',
    },
  };

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
  window.gtag('consent', 'default', { ...DENIED });

  /** Read only a recognized, unexpired preference; unavailable storage denies consent. */
  function readChoice() {
    try {
      const saved = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
      const age = Date.now() - saved?.savedAt;
      if (saved?.version === STORAGE_VERSION
        && ['granted', 'denied'].includes(saved.analytics)
        && Number.isFinite(saved.savedAt) && age >= 0 && age < CONSENT_MAX_AGE_MS) {
        return saved.analytics;
      }
    } catch {
      // Storage can be disabled or contain an invalid preference.
    }
    return null;
  }

  /** Remove this site's first-party Analytics cookies when consent is declined. */
  function clearAnalyticsCookies() {
    const domains = [''];
    const labels = window.location.hostname.split('.');
    while (labels.length > 1) {
      domains.push(labels.join('.'));
      labels.shift();
    }
    try {
      document.cookie.split(';').forEach((cookie) => {
        const name = cookie.trim().split('=')[0];
        if (name !== '_ga' && !name.startsWith('_ga_')) {
          return;
        }
        domains.forEach((domain) => {
          document.cookie = `${name}=; Max-Age=0; Path=/; SameSite=Lax${domain ? `; Domain=${domain}` : ''}`;
        });
      });
    } catch {
      // A browser that blocks cookie access must still offer consent controls.
    }
  }

  /** Apply analytics consent immediately; advertising consent is always denied. */
  function applyChoice(analytics) {
    window.gtag('consent', 'update', { ...DENIED, analytics_storage: analytics });
    if (analytics === 'denied') {
      clearAnalyticsCookies();
    }
  }

  let choice = readChoice();
  if (choice) {
    applyChoice(choice);
  } else {
    clearAnalyticsCookies();
  }

  /** Build text-only elements without interpreting translated copy as HTML. */
  function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text) {
      node.textContent = text;
    }
    return node;
  }

  /** Render an in-flow banner and a permanent footer control, without covering page content. */
  function initConsentControls() {
    if (document.getElementById('cookie-consent')) {
      return;
    }
    const lang = document.documentElement.lang.startsWith('fr') ? 'fr' : 'en';
    const copy = COPY[lang];
    const banner = element('section', 'cookie-consent');
    banner.id = 'cookie-consent';
    banner.setAttribute('aria-labelledby', 'cookie-consent-title');
    banner.hidden = choice !== null;
    const shell = element('div', 'shell cookie-consent__content');
    const heading = element('h2', 'cookie-consent__title', copy.title);
    heading.id = 'cookie-consent-title';
    heading.tabIndex = -1;
    const explanation = element('p', '', copy.explanation);
    const days = new Intl.NumberFormat(lang).format(CONSENT_DAYS);
    const details = element('p', 'cookie-consent__details', copy.details.replace('{days}', days));
    const privacy = element('a', '', copy.privacy);
    privacy.href = `https://policies.google.com/privacy?hl=${lang}`;
    const actions = element('div', 'cookie-consent__actions');
    const accept = element('button', 'btn btn--outline', copy.accept);
    accept.type = 'button';
    accept.dataset.consentChoice = 'granted';
    const reject = element('button', 'btn btn--outline', copy.reject);
    reject.type = 'button';
    reject.dataset.consentChoice = 'denied';
    actions.append(accept, reject);
    shell.append(heading, explanation, details, privacy, actions);
    banner.append(shell);
    const skipLink = document.querySelector('.skip-link');
    if (skipLink) {
      skipLink.after(banner);
    } else {
      document.body.prepend(banner);
    }

    const settings = element('button', 'cookie-settings', copy.settings);
    settings.type = 'button';
    settings.setAttribute('aria-controls', banner.id);
    settings.setAttribute('aria-expanded', String(!banner.hidden));
    const footer = document.querySelector('.footer-base') || document.querySelector('footer') || document.body;
    footer.append(settings);
    const status = element('p', 'shell cookie-consent__status');
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    banner.after(status);
    let openedFromSettings = false;

    settings.addEventListener('click', () => {
      openedFromSettings = true;
      banner.hidden = false;
      settings.setAttribute('aria-expanded', 'true');
      heading.focus();
    });

    /** Save the explicit choice; a storage failure never prevents the consent update. */
    function choose(analytics) {
      choice = analytics;
      applyChoice(choice);
      let saved = true;
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify({
          version: STORAGE_VERSION, analytics: choice, savedAt: Date.now(),
        }));
      } catch {
        saved = false;
      }
      status.textContent = saved ? copy.saved : copy.notSaved;
      status.classList.toggle('sr-only', saved);
      banner.hidden = true;
      settings.setAttribute('aria-expanded', 'false');
      const focusTarget = openedFromSettings ? settings : document.querySelector('.site-header a') || settings;
      focusTarget.focus();
    }

    accept.addEventListener('click', () => choose('granted'));
    reject.addEventListener('click', () => choose('denied'));

    // Keep another open tab consistent when the visitor changes or clears their preference.
    window.addEventListener('storage', (event) => {
      if (event.key !== STORAGE_KEY && event.key !== null) {
        return;
      }
      choice = readChoice();
      applyChoice(choice || 'denied');
      banner.hidden = choice !== null;
      settings.setAttribute('aria-expanded', String(!banner.hidden));
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initConsentControls, { once: true });
  } else {
    initConsentControls();
  }
})();
