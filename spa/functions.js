// functions.js

// Function to convert hex string to Uint8Array
export function hexStringToUint8Array(hexString) {
	let result = [];
	for (let i = 0; i < hexString.length; i += 2) {
		result.push(parseInt(hexString.substring(i, i + 2), 16));
	}
	return new Uint8Array(result);
}

// Function to convert Base64 to Base64URL
export function base64UrlEncode(arrayBuffer) {
	return btoa(String.fromCharCode.apply(null, new Uint8Array(arrayBuffer)))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/, ''); // Remove any padding
}

// Function to convert Base64URL to Uint8Array
export function urlBase64ToUint8Array(base64String) {
	const padding = '='.repeat((4 - base64String.length % 4) % 4);
	const base64 = (base64String + padding)
		.replace(/\-/g, '+')
		.replace(/_/g, '/');

	const rawData = window.atob(base64);
	const outputArray = new Uint8Array(rawData.length);

	for (let i = 0; i < rawData.length; i++) {
		outputArray[i] = rawData.charCodeAt(i);
	}
	return outputArray;
}
