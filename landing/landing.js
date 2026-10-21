/*
 * Wampums public site (wampums.app): feature tabs on the home page, and the
 * demo request dialog on every page. Each language has its own static page, so
 * every visible string is already in the HTML; this script only reads it from there.
 */

const MIN_NAME_LENGTH = 2;
const MIN_MESSAGE_LENGTH = 10;
const DEMO_REDIRECT_DELAY_MS = 2000;
const HTTP_TOO_MANY_REQUESTS = 429;
const DEMO_URL = 'https://demo.wampums.app';
const CONTACT_PATH = '/api/v1/public/contact-demo';

/** The landing host has no API of its own; the demo instance answers. */
function contactUrl() {
  const host = window.location.hostname;
  if (host === 'wampums.app' || host === 'www.wampums.app') {
    return `${DEMO_URL}${CONTACT_PATH}`;
  }
  return `${window.location.origin}${CONTACT_PATH}`;
}

/* ---------- Feature tabs ---------- */

/**
 * Turns the role panels into tabs. Without JavaScript every panel stays
 * visible under its own heading, so nothing is out of reach.
 */
function initTabs() {
  const tablist = document.querySelector('[role="tablist"]');
  if (!tablist) {
    return;
  }
  const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
  const panels = tabs.map((tab) => document.getElementById(tab.getAttribute('aria-controls')));

  panels.forEach((panel, index) => {
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', tabs[index].id);
    panel.setAttribute('tabindex', '0');
  });

  const select = (tab, moveFocus) => {
    tabs.forEach((other, index) => {
      const selected = other === tab;
      other.setAttribute('aria-selected', String(selected));
      other.tabIndex = selected ? 0 : -1;
      panels[index].hidden = !selected;
    });
    if (moveFocus) {
      tab.focus();
    }
  };

  tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => select(tab, false));
    tab.addEventListener('keydown', (event) => {
      const last = tabs.length - 1;
      const targets = {
        ArrowRight: index === last ? 0 : index + 1,
        ArrowLeft: index === 0 ? last : index - 1,
        Home: 0,
        End: last,
      };
      if (event.key in targets) {
        event.preventDefault();
        select(tabs[targets[event.key]], true);
      }
    });
  });

  tablist.hidden = false;
  select(tabs[0], false);
}

/* ---------- Demo request dialog ---------- */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([tabindex="-1"]), textarea, select';

function initDemoDialog() {
  const modal = document.getElementById('demoModal');
  const form = document.getElementById('demoForm');
  if (!modal || !form) {
    return;
  }
  const dialog = modal.querySelector('[role="dialog"]');
  const success = document.getElementById('formSuccess');
  const status = document.getElementById('formStatus');
  const submit = form.querySelector('[type="submit"]');
  const submitLabel = submit.textContent;
  const fields = {
    name: document.getElementById('name'),
    email: document.getElementById('email'),
    organization: document.getElementById('organization'),
    phone: document.getElementById('phone'),
    message: document.getElementById('message'),
    honeypot: document.getElementById('honeypot'),
  };
  let opener = null;
  let sent = false;

  const setFieldError = (input, invalid) => {
    input.closest('.form-group').classList.toggle('error', invalid);
    input.setAttribute('aria-invalid', String(invalid));
  };

  const clearErrors = () => {
    Object.values(fields).forEach((input) => {
      if (input.closest('.form-group')) {
        setFieldError(input, false);
      }
    });
    status.hidden = true;
    status.textContent = '';
  };

  const open = (trigger) => {
    opener = trigger;
    modal.hidden = false;
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
    fields.name.focus();
  };

  const close = () => {
    if (sent) {
      return;
    }
    modal.classList.remove('active');
    modal.hidden = true;
    document.body.style.overflow = '';
    clearErrors();
    opener?.focus();
  };

  document.querySelectorAll('[data-open-demo-modal]').forEach((button) => {
    button.addEventListener('click', () => open(button));
  });
  modal.querySelectorAll('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', close);
  });
  modal.addEventListener('click', (event) => {
    if (event.target === modal) {
      close();
    }
  });

  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }
    const focusable = Array.from(dialog.querySelectorAll(FOCUSABLE))
      .filter((element) => element.offsetParent !== null);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });

  // A message clears as soon as its field changes.
  [fields.name, fields.email, fields.message].forEach((input) => {
    input.addEventListener('input', () => setFieldError(input, false));
  });

  const validate = () => {
    const checks = [
      [fields.name, fields.name.value.trim().length >= MIN_NAME_LENGTH],
      [fields.email, /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fields.email.value.trim())],
      [fields.message, fields.message.value.trim().length >= MIN_MESSAGE_LENGTH],
    ];
    checks.forEach(([input, valid]) => setFieldError(input, !valid));
    const firstInvalid = checks.find(([, valid]) => !valid);
    firstInvalid?.[0].focus();
    return !firstInvalid;
  };

  const showFailure = (message) => {
    status.textContent = message;
    status.hidden = false;
    submit.disabled = false;
    submit.textContent = submitLabel;
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearErrors();
    if (!validate()) {
      return;
    }

    submit.disabled = true;
    submit.textContent = submit.dataset.busyLabel;

    let response;
    try {
      response = await fetch(contactUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: fields.name.value.trim(),
          email: fields.email.value.trim(),
          organization: fields.organization.value.trim(),
          phone: fields.phone.value.trim(),
          message: fields.message.value.trim(),
          honeypot: fields.honeypot.value,
        }),
      });
    } catch {
      showFailure(status.dataset.generic);
      return;
    }

    const data = await response.json().catch(() => ({}));
    if (response.ok && data.success) {
      sent = true;
      form.hidden = true;
      success.hidden = false;
      setTimeout(() => {
        window.location.href = DEMO_URL;
      }, DEMO_REDIRECT_DELAY_MS);
      return;
    }

    // The server explains in English for developers; point at the fields instead.
    const badFields = Array.isArray(data.errors) ? data.errors.map((item) => item.field) : [];
    badFields.forEach((name) => {
      if (fields[name]?.closest('.form-group')?.querySelector('.form-error')) {
        setFieldError(fields[name], true);
      }
    });
    showFailure(response.status === HTTP_TOO_MANY_REQUESTS ? status.dataset.busy : status.dataset.generic);
  });
}

initTabs();
initDemoDialog();
