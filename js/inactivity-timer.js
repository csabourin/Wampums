// inactivity-timer.js

let inactivityTimer;
const INACTIVITY_TIMEOUT = 5 * 60 * 1000; // 5 minutes in milliseconds

function resetInactivityTimer() {
    if (!navigator.onLine) return; // Don't set timer if offline
    clearTimeout(inactivityTimer);
    inactivityTimer = setTimeout(showInactivityModal, INACTIVITY_TIMEOUT);
}

function showInactivityModal() {
    if (!navigator.onLine) return; // Don't show modal if offline
    setAppDormant(true);
    const modal = document.getElementById('inactivity-modal');
    if (modal) {
        modal.style.display = 'block';
    }
    notifyServiceWorker('dormant');
    if (typeof stopRefreshInterval === 'function') {
        stopRefreshInterval();
    }
}

function hideInactivityModal() {
    const modal = document.getElementById('inactivity-modal');
    if (modal) {
        modal.style.display = 'none';
    }
}

function refreshPage() {
    setAppDormant(false);
    notifyServiceWorker('active');
    if (typeof startRefreshInterval === 'function') {
        startRefreshInterval();
    }
    location.reload();
}

function notifyServiceWorker(state) {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
            type: 'appState',
            state: state
        });
    }
}

function setAppDormant(isDormant) {
    window.isAppDormant = isDormant;
    // Dispatch a custom event to notify other scripts
    window.dispatchEvent(new CustomEvent('appDormantStateChange', { detail: { isDormant } }));
}

// Event listeners to reset the timer
document.addEventListener('mousemove', resetInactivityTimer);
document.addEventListener('keypress', resetInactivityTimer);

// Listen for online/offline events
window.addEventListener('online', resetInactivityTimer);
window.addEventListener('offline', () => {
    clearTimeout(inactivityTimer);
    hideInactivityModal();
    setAppDormant(false);
    notifyServiceWorker('active');
});

// Initial setup
if (navigator.onLine) {
    resetInactivityTimer();
}

// Expose functions to global scope
window.showInactivityModal = showInactivityModal;
window.hideInactivityModal = hideInactivityModal;
window.refreshPage = refreshPage;