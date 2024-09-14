import { initializeDB, saveOfflineData, getOfflineData, clearOfflineData } from './indexedDB.js';
import { initRouter, Router } from './router.js';
import { Login } from './login.js';

const app = {
    isLoggedIn: false,
    userRole: null,
    userFullName: null,
    lang: 'fr', // Default language
    currentPage: '',
    translations: {},
    db: null,
    router: null,

    async init() {
        console.log('App init started');
        try {
            this.db = await initializeDB();
            await this.loadTranslations();
            this.registerServiceWorker();

            // Check localStorage
            console.log('LocalStorage at init:', {
                jwtToken: localStorage.getItem('jwtToken'),
                userRole: localStorage.getItem('userRole'),
                userFullName: localStorage.getItem('userFullName')
            });

            // Check for existing session
            const session = Login.checkSession();
            this.isLoggedIn = session.isLoggedIn;
            this.userRole = session.userRole;
            this.userFullName = session.userFullName;

            console.log('Session checked:', {
                isLoggedIn: this.isLoggedIn,
                userRole: this.userRole,
                userFullName: this.userFullName
            });

            this.router = initRouter(this);

            // Instead of immediately navigating, let the router handle the initial route
            this.router.route(window.location.pathname);

            this.syncOfflineData();
            console.log('App init completed');
        } catch (error) {
            console.error('Initialization error:', error);
        }
    },

    async loadTranslations() {
        console.log('Loading translations');
        try {
            const response = await fetch('/get_translations.php');
            this.translations = await response.json();
            console.log('Translations loaded:', this.translations);
        } catch (error) {
            console.error('Error loading translations:', error);
            this.translations = {};
        }
    },

    registerServiceWorker() {
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/service-worker.js')
                .then(registration => {
                    console.log('Service Worker registered with scope:', registration.scope);
                })
                .catch(error => {
                    console.error('Service Worker registration failed:', error);
                });
        }
    },

    showLoading() {
        document.getElementById('loading-indicator').style.display = 'block';
    },

    hideLoading() {
        document.getElementById('loading-indicator').style.display = 'none';
    },

    renderError(message) {
        console.log('Rendering error:', message);
        const errorContent = `
            <h1>${this.translate('error')}</h1>
            <p>${message}</p>
            <p><a href="/">${this.translate('back_to_home')}</a></p>
        `;
        document.getElementById('app').innerHTML = errorContent;
    },

    translate(key) {
        return this.translations[key] || key;
    },

    async syncOfflineData() {
        if (navigator.onLine) {
            try {
                const offlineData = await getOfflineData();
                if (offlineData.length > 0) {
                    // Implement your sync logic here
                    console.log('Syncing offline data:', offlineData);
                    // After successful sync, clear the offline data
                    await clearOfflineData();
                }
            } catch (error) {
                console.error('Error syncing offline data:', error);
            }
        }
    }
};

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOMContentLoaded event fired');
    app.init();
});

export const translate = app.translate.bind(app);