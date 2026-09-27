/**
 * Loads the Socket.IO client the API server serves at /socket.io/socket.io.js.
 */

const SOCKET_IO_CLIENT_PATH = '/socket.io/socket.io.js';

let loading = null;

/**
 * Load the Socket.IO client once and return its `io` factory.
 * @returns {Promise<Function>} The global `io` function
 */
export function loadSocketIOClient() {
  if (window.io) {
    return Promise.resolve(window.io);
  }
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SOCKET_IO_CLIENT_PATH;
      script.onload = () => resolve(window.io);
      script.onerror = () => {
        loading = null;
        script.remove();
        reject(new Error('Failed to load Socket.io client'));
      };
      document.head.appendChild(script);
    });
  }
  return loading;
}
