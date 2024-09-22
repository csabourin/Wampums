document.addEventListener("DOMContentLoaded", function () {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("/service-worker.js", { type: "module" })
      .then(function (registration) {
        console.log(
          "Service Worker registered with scope:",
          registration.scope
        );
      })
      .catch(function (error) {
        console.log("Service Worker registration failed:", error);
      });
  }

  // Cache the parent list for offline use
  cacheParentList();
});

function cacheParentList() {
  if ("caches" in window) {
    const parentList = document.getElementById("childList").innerHTML;
    caches.open("parent-contact-list-cache").then(function (cache) {
      cache.put("parent-contact-list", new Response(parentList));
    });
  }
}
