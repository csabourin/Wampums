/**
 * "Install the app": the browser's own prompt when it offers one, otherwise
 * the steps for this device's browser. The action stays available, so someone
 * who dismissed a prompt, or uses Safari or Firefox, can still install.
 *
 * @module spa/modules/install/InstallAppDialog
 */
import { translate } from '../../app.js';
import { openModal } from '../../utils/ModalUtils.js';
import { canPromptInstall, installPlatform, requestInstall } from '../../utils/InstallPromptUtils.js';

/**
 * The steps for each kind of device, in its browser's words.
 *
 * @param {'ios'|'android'|'desktop'} platform
 * @returns {{ steps: string[], ordered: boolean }}
 */
function instructionsFor(platform) {
  if (platform === 'ios') {
    return {
      ordered: true,
      steps: [
        translate('install_app_ios_step_share'),
        translate('install_app_ios_step_add'),
        translate('install_app_ios_step_confirm'),
      ],
    };
  }
  if (platform === 'android') {
    return {
      ordered: true,
      steps: [
        translate('install_app_android_step_menu'),
        translate('install_app_android_step_install'),
        translate('install_app_android_step_confirm'),
      ],
    };
  }
  // On a computer these are alternatives, one per browser
  return {
    ordered: false,
    steps: [
      translate('install_app_desktop_chrome_edge'),
      translate('install_app_desktop_safari'),
      translate('install_app_desktop_firefox'),
    ],
  };
}

/**
 * Open the dialog explaining how to install the app on this device.
 *
 * @param {'ios'|'android'|'desktop'} [platform] - Defaults to this device
 * @returns {{ close: Function }} Modal handle
 */
export function openInstallAppDialog(platform = installPlatform()) {
  const { steps, ordered } = instructionsFor(platform);
  const listTag = ordered ? 'ol' : 'ul';
  const items = steps.map((step) => `<li>${step}</li>`).join('');
  return openModal({
    id: 'install-app-dialog',
    title: translate('install_app_dialog_title'),
    size: 'small',
    body: `
      <p>${translate('install_app_dialog_intro')}</p>
      <${listTag} class="install-app-steps">${items}</${listTag}>
    `,
    footer: `<button type="button" class="button button--primary" data-modal-close>${translate('close')}</button>`,
  });
}

/**
 * Offer to install the app: the browser's prompt if it has one, else the
 * steps for this device. A dismissed prompt is the person's answer and opens
 * nothing more; the next try shows the steps.
 *
 * @returns {Promise<'accepted'|'dismissed'|'instructions'>} What was offered and chosen
 */
export async function offerAppInstall() {
  if (canPromptInstall()) {
    const outcome = await requestInstall();
    if (outcome !== 'unavailable') {
      return outcome;
    }
  }
  openInstallAppDialog();
  return 'instructions';
}
