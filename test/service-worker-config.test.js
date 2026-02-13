/**
 * Service Worker Configuration Tests
 * 
 * These tests verify that the service worker configuration prevents
 * caching issues that can cause 404 errors for dynamically imported modules.
 */

const fs = require('fs');
const path = require('path');

describe('Service Worker Configuration', () => {
  let viteConfig;
  let serviceWorkerSource;

  beforeAll(() => {
    // Load vite config
    const viteConfigPath = path.join(__dirname, '..', 'vite.config.js');
    const viteConfigContent = fs.readFileSync(viteConfigPath, 'utf8');
    
    // Load service worker source
    const swPath = path.join(__dirname, '..', 'src-sw.js');
    serviceWorkerSource = fs.readFileSync(swPath, 'utf8');
    
    // Extract PWA config from vite.config.js
    viteConfig = viteConfigContent;
  });

  describe('Vite PWA Configuration', () => {
    test('should exclude index.html from precaching to prevent stale asset references', () => {
      // Verify index.html is in globIgnores to prevent caching old HTML with old asset hashes
      expect(viteConfig).toContain('globIgnores');
      expect(viteConfig).toMatch(/globIgnores.*index\.html/s);
    });

    test('should use injectManifest strategy for custom service worker logic', () => {
      expect(viteConfig).toContain('strategies: "injectManifest"');
    });

    test('should set registerType to prompt for controlled updates', () => {
      expect(viteConfig).toContain('registerType: "prompt"');
    });

    test('should cache static assets like JS, CSS, images', () => {
      expect(viteConfig).toMatch(/globPatterns.*js.*css.*html/s);
    });
  });

  describe('Service Worker Caching Strategy', () => {
    test('should NOT use createHandlerBoundToURL which serves precached HTML', () => {
      // createHandlerBoundToURL would serve stale HTML from precache
      expect(serviceWorkerSource).not.toContain('createHandlerBoundToURL');
    });

    test('should import NetworkFirst strategy for HTML navigation', () => {
      // NetworkFirst ensures fresh HTML while providing offline fallback
      expect(serviceWorkerSource).toContain('import');
      expect(serviceWorkerSource).toMatch(/NetworkFirst/);
    });

    test('should use NetworkFirst handler for navigation routes', () => {
      // Verify navigation uses NetworkFirst, not precached HTML
      expect(serviceWorkerSource).toContain('new NetworkFirst');
      expect(serviceWorkerSource).toContain('html-cache');
    });

    test('should set short cache TTL for HTML (1 hour)', () => {
      // Short TTL ensures users get updated HTML quickly
      expect(serviceWorkerSource).toMatch(/maxAgeSeconds.*60.*60/s); // 1 hour
    });

    test('should use precacheAndRoute for static assets', () => {
      // Static assets (JS/CSS with hashes) should still be precached
      expect(serviceWorkerSource).toContain('precacheAndRoute');
      expect(serviceWorkerSource).toContain('self.__WB_MANIFEST');
    });

    test('should clean up outdated caches on activation', () => {
      expect(serviceWorkerSource).toContain('cleanupOutdatedCaches');
    });
  });

  describe('Navigation Route Configuration', () => {
    test('should register navigation route', () => {
      expect(serviceWorkerSource).toContain('NavigationRoute');
      expect(serviceWorkerSource).toContain('registerRoute');
    });

    test('should deny API routes from navigation fallback', () => {
      expect(serviceWorkerSource).toMatch(/denylist.*\/api\//s);
    });

    test('should deny public routes from navigation fallback', () => {
      expect(serviceWorkerSource).toMatch(/denylist.*\/public\//s);
    });

    test('should deny offline.html from navigation fallback', () => {
      expect(serviceWorkerSource).toMatch(/offline\\\.html/s);
    });
  });

  describe('Cache Invalidation', () => {
    test('should use CacheableResponsePlugin to cache only successful responses', () => {
      expect(serviceWorkerSource).toContain('CacheableResponsePlugin');
      expect(serviceWorkerSource).toMatch(/statuses.*200/s);
    });

    test('should use ExpirationPlugin for cache management', () => {
      expect(serviceWorkerSource).toContain('ExpirationPlugin');
    });

    test('should prevent config.js from being cached', () => {
      // config.js must never be cached to avoid stale configuration
      expect(serviceWorkerSource).toMatch(/config\.js.*NetworkOnly/s);
    });
  });
});
