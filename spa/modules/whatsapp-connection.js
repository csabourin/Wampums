/**
 * WhatsApp Connection Module
 *
 * Handles WhatsApp Baileys connection: QR code display, connection status, disconnect
 * Integrates with Socket.io for real-time QR code updates
 *
 * @module modules/whatsapp-connection
 */

import { makeApiRequest } from "../api/api-core.js";
import { debugLog, debugError } from "../utils/DebugUtils.js";
import { translate } from "../app.js";
import { escapeHTML } from "../utils/SecurityUtils.js";
import io from 'socket.io-client';

/**
 * WhatsApp Connection Management Class
 */
export class WhatsAppConnectionModule {
  constructor(app) {
    this.app = app;
    this.connectionStatus = null;
    this.isLoading = false;
    this.socket = null;
    this.qrCodeDataURL = null;
  }

  /**
   * Initialize the module
   */
  async init() {
    debugLog("Initializing WhatsAppConnectionModule");
    try {
      await this.loadConnectionStatus();
      this.initializeSocket();
    } catch (error) {
      debugError("Error initializing WhatsApp connection module:", error);
    }
  }

  /**
   * Initialize Socket.io connection for real-time QR code updates
   */
  initializeSocket() {
    const token = localStorage.getItem('jwtToken');
    if (!token) {
      debugError("No JWT token found for Socket.io authentication");
      return;
    }

    // Connect to Socket.io server
    const socketUrl = window.location.origin;
    this.socket = io(socketUrl, {
      auth: {
        token: token
      }
    });

    // Handle connection
    this.socket.on('connect', () => {
      debugLog('Socket.io connected:', this.socket.id);
    });

    // Handle QR code event
    this.socket.on('whatsapp-qr', (data) => {
      debugLog('Received WhatsApp QR code:', data);
      this.qrCodeDataURL = data.qrCode;
      this.renderQRCode(data.qrCode);
    });

    // Handle connection success event
    this.socket.on('whatsapp-connected', (data) => {
      debugLog('WhatsApp connected:', data);
      this.qrCodeDataURL = null;
      this.app.showMessage(
        translate('whatsapp_connected_success') || 'WhatsApp connected successfully!',
        'success'
      );
      this.loadConnectionStatus();
    });

    // Handle disconnection event
    this.socket.on('whatsapp-disconnected', (data) => {
      debugLog('WhatsApp disconnected:', data);
      this.qrCodeDataURL = null;
      this.loadConnectionStatus();
    });

    // Handle connection error
    this.socket.on('connect_error', (error) => {
      debugError('Socket.io connection error:', error);
    });

    // Handle disconnection
    this.socket.on('disconnect', () => {
      debugLog('Socket.io disconnected');
    });
  }

  /**
   * Load WhatsApp connection status from API
   */
  async loadConnectionStatus() {
    try {
      debugLog("Loading WhatsApp connection status");
      const response = await makeApiRequest("v1/whatsapp/baileys/status", {
        method: "GET",
      });

      if (response.success) {
        this.connectionStatus = response.data;
        debugLog("WhatsApp connection status loaded:", this.connectionStatus);
      } else {
        throw new Error(response.message || "Failed to load WhatsApp connection status");
      }
    } catch (error) {
      debugError("Error loading WhatsApp connection status:", error);
      this.connectionStatus = {
        isConnected: false,
        connectedPhoneNumber: null,
      };
    }
  }

  /**
   * Render the WhatsApp connection section
   * @returns {string} HTML content
   */
  render() {
    const isConnected = this.connectionStatus?.isConnected || false;
    const phoneNumber = escapeHTML(this.connectionStatus?.connectedPhoneNumber || "Not connected");

    return `
      <section class="account-section whatsapp-connection-section">
        <h2>${translate("whatsapp_connection_title") || "WhatsApp Connection (Baileys)"}</h2>
        <p class="section-description">
          ${translate("whatsapp_connection_description") || "Connect your personal WhatsApp account to send announcements. Scan the QR code with your phone."}
        </p>

        <div class="whatsapp-status-box ${isConnected ? 'connected' : 'disconnected'}">
          <p><strong>${translate("status") || "Status"}:</strong>
            ${isConnected
              ? `<span class="status-badge connected">✓ ${translate("connected") || "Connected"}</span>`
              : `<span class="status-badge disconnected">✗ ${translate("disconnected") || "Disconnected"}</span>`
            }
          </p>
          ${isConnected
            ? `<p><strong>${translate("phone_number") || "Phone Number"}:</strong> ${phoneNumber}</p>`
            : ''
          }
        </div>

        ${!isConnected
          ? `
            <div class="whatsapp-connect-container">
              <button id="whatsapp-connect-btn" class="btn btn-primary">
                ${translate("whatsapp_connect_button") || "Connect WhatsApp"}
              </button>

              <div id="whatsapp-qr-container" style="display: none; margin-top: 20px;">
                <h3>${translate("scan_qr_code") || "Scan QR Code with WhatsApp"}</h3>
                <div id="whatsapp-qr-code" style="text-align: center; padding: 20px; background: white; border-radius: 8px;">
                  <p>${translate("loading") || "Loading QR code..."}</p>
                </div>
                <div class="qr-instructions" style="margin-top: 15px; padding: 15px; background: #f5f5f5; border-radius: 8px;">
                  <h4>${translate("instructions") || "Instructions"}:</h4>
                  <ol style="margin-left: 20px;">
                    <li>${translate("whatsapp_qr_step1") || "Open WhatsApp on your phone"}</li>
                    <li>${translate("whatsapp_qr_step2") || "Go to Settings → Linked Devices"}</li>
                    <li>${translate("whatsapp_qr_step3") || "Tap 'Link a Device'"}</li>
                    <li>${translate("whatsapp_qr_step4") || "Scan this QR code"}</li>
                  </ol>
                  <div style="margin-top: 10px; padding: 10px; background: #fff3cd; border-left: 4px solid #ffc107; border-radius: 4px;">
                    <strong>⚠️ ${translate("important") || "Important"}:</strong>
                    <p style="margin: 5px 0 0 0; font-size: 0.9em;">
                      ${translate("whatsapp_safety_warning") || "This uses an unofficial API. Only send to contacts who have your number saved. Add 2-5 second delays between messages."}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          `
          : `
            <div class="whatsapp-disconnect-container" style="margin-top: 20px;">
              <button id="whatsapp-disconnect-btn" class="btn btn-danger">
                ${translate("whatsapp_disconnect_button") || "Disconnect WhatsApp"}
              </button>
            </div>

            <div class="whatsapp-test-container" style="margin-top: 20px;">
              <h3>${translate("send_test_message") || "Send Test Message"}</h3>
              <form id="whatsapp-test-form" class="account-form">
                <div class="form-group">
                  <label for="test-phone-number">${translate("phone_number") || "Phone Number"}</label>
                  <input
                    type="tel"
                    id="test-phone-number"
                    name="phoneNumber"
                    placeholder="+15551234567"
                    pattern="^\\+[1-9]\\d{6,14}$"
                    required
                  />
                  <small class="form-text">${translate("e164_format") || "Format: +[country code][number]"}</small>
                </div>
                <div class="form-group">
                  <label for="test-message">${translate("message") || "Message"}</label>
                  <textarea
                    id="test-message"
                    name="message"
                    rows="3"
                    required
                  ></textarea>
                </div>
                <button type="submit" class="btn btn-primary" id="test-message-submit">
                  ${translate("send_test_message_button") || "Send Test Message"}
                </button>
              </form>
            </div>
          `
        }
      </section>
    `;
  }

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    const connectBtn = document.getElementById("whatsapp-connect-btn");
    if (connectBtn) {
      connectBtn.addEventListener("click", () => this.handleConnect());
    }

    const disconnectBtn = document.getElementById("whatsapp-disconnect-btn");
    if (disconnectBtn) {
      disconnectBtn.addEventListener("click", () => this.handleDisconnect());
    }

    const testForm = document.getElementById("whatsapp-test-form");
    if (testForm) {
      testForm.addEventListener("submit", (e) => this.handleTestMessage(e));
    }
  }

  /**
   * Handle WhatsApp connection
   */
  async handleConnect() {
    if (this.isLoading) return;

    try {
      this.isLoading = true;
      const connectBtn = document.getElementById("whatsapp-connect-btn");
      if (connectBtn) {
        connectBtn.disabled = true;
        connectBtn.textContent = translate("connecting") || "Connecting...";
      }

      debugLog("Initiating WhatsApp connection");

      const response = await makeApiRequest("v1/whatsapp/baileys/connect", {
        method: "POST",
      });

      if (response.success) {
        // Show QR code container
        const qrContainer = document.getElementById("whatsapp-qr-container");
        if (qrContainer) {
          qrContainer.style.display = "block";
        }

        this.app.showMessage(
          translate("whatsapp_qr_pending") || "QR code will appear shortly. Please wait...",
          "info"
        );

        // Hide connect button
        if (connectBtn) {
          connectBtn.style.display = "none";
        }
      } else {
        throw new Error(response.message || "Failed to initiate WhatsApp connection");
      }
    } catch (error) {
      debugError("Error connecting WhatsApp:", error);
      this.app.showMessage(
        error.message || translate("whatsapp_connect_error") || "Failed to connect WhatsApp",
        "error"
      );
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Render QR code image
   * @param {string} qrDataURL - QR code data URL
   */
  renderQRCode(qrDataURL) {
    const qrCodeDiv = document.getElementById("whatsapp-qr-code");
    if (qrCodeDiv) {
      qrCodeDiv.innerHTML = `<img src="${qrDataURL}" alt="WhatsApp QR Code" style="max-width: 300px; border: 2px solid #25D366; border-radius: 8px;" />`;
    }
  }

  /**
   * Handle WhatsApp disconnection
   */
  async handleDisconnect() {
    if (this.isLoading) return;

    const confirmed = confirm(
      translate("whatsapp_disconnect_confirm") ||
      "Are you sure you want to disconnect WhatsApp? You will need to scan the QR code again to reconnect."
    );

    if (!confirmed) return;

    try {
      this.isLoading = true;
      const disconnectBtn = document.getElementById("whatsapp-disconnect-btn");
      if (disconnectBtn) {
        disconnectBtn.disabled = true;
        disconnectBtn.textContent = translate("disconnecting") || "Disconnecting...";
      }

      debugLog("Disconnecting WhatsApp");

      const response = await makeApiRequest("v1/whatsapp/baileys/disconnect", {
        method: "POST",
      });

      if (response.success) {
        this.app.showMessage(
          translate("whatsapp_disconnected_success") || "WhatsApp disconnected successfully",
          "success"
        );

        // Reload connection status and re-render
        await this.loadConnectionStatus();
        location.reload(); // Reload page to update UI
      } else {
        throw new Error(response.message || "Failed to disconnect WhatsApp");
      }
    } catch (error) {
      debugError("Error disconnecting WhatsApp:", error);
      this.app.showMessage(
        error.message || translate("whatsapp_disconnect_error") || "Failed to disconnect WhatsApp",
        "error"
      );
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * Handle test message sending
   * @param {Event} event - Form submit event
   */
  async handleTestMessage(event) {
    event.preventDefault();

    if (this.isLoading) return;

    const form = event.target;
    const phoneNumberInput = form.querySelector("#test-phone-number");
    const messageInput = form.querySelector("#test-message");
    const submitButton = form.querySelector("#test-message-submit");

    const phoneNumber = phoneNumberInput.value.trim();
    const message = messageInput.value.trim();

    try {
      this.isLoading = true;
      submitButton.disabled = true;
      submitButton.textContent = translate("sending") || "Sending...";

      debugLog("Sending test WhatsApp message:", { phoneNumber, message });

      const response = await makeApiRequest("v1/whatsapp/baileys/test", {
        method: "POST",
        body: JSON.stringify({ phoneNumber, message }),
      });

      if (response.success) {
        this.app.showMessage(
          translate("test_message_sent_success") || "Test message sent successfully!",
          "success"
        );
        form.reset();
      } else {
        throw new Error(response.message || "Failed to send test message");
      }
    } catch (error) {
      debugError("Error sending test message:", error);
      this.app.showMessage(
        error.message || translate("test_message_error") || "Failed to send test message",
        "error"
      );
    } finally {
      this.isLoading = false;
      submitButton.disabled = false;
      submitButton.textContent = translate("send_test_message_button") || "Send Test Message";
    }
  }

  /**
   * Cleanup - disconnect Socket.io
   */
  destroy() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      debugLog("Socket.io disconnected and cleaned up");
    }
  }
}
