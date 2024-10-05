<?php
require_once 'config.php';
require_once 'functions.php';
initializeApp();

header('Content-Type: application/javascript');

$initialData = [
    'isLoggedIn' => isLoggedIn(),
    'userRole' => $_SESSION['user_role'] ?? null,
    'lang' => $lang
];

echo 'window.initialData = ' . json_encode($initialData) . ';';
?>

document.addEventListener("DOMContentLoaded", function() {
    let newsWidget = document.getElementById("news-widget");

    // Lazy load the news widget
    fetch(newsWidget.dataset.lazyLoad)
        .then(response => response.text())
        .then(data => {
            newsWidget.innerHTML = data;

            // Now that the content is loaded, find the accordion
            const accordion = document.querySelector('.news-accordion');
            if (!accordion) {
                alert('News accordion not found');
                return; // Stop execution if the accordion is not found
            }

            const accordionHeader = accordion.querySelector('.news-accordion-header');
            const accordionContent = accordion.querySelector('.news-accordion-content');

            // Function to toggle accordion
            function toggleAccordion() {
                accordion.classList.toggle('open');
                saveAccordionState();
            }

            // Function to save accordion state
            function saveAccordionState() {
                localStorage.setItem('newsAccordionOpen', accordion.classList.contains('open'));
                localStorage.setItem('lastNewsTimestamp', accordion.dataset.latestTimestamp);
            }

            // Function to load accordion state
            function loadAccordionState() {
                const isOpen = localStorage.getItem('newsAccordionOpen');
                const lastTimestamp = localStorage.getItem('lastNewsTimestamp');
                const latestNewsTimestamp = accordion.dataset.latestTimestamp;

                // Open accordion if no localStorage key exists or if there's new news
                if (isOpen === null || (lastTimestamp && latestNewsTimestamp > lastTimestamp)) {
                    accordion.classList.add('open');
                } else if (isOpen === 'true') {
                    accordion.classList.add('open');
                }
            }

            // Add click event listener to header
            accordionHeader.addEventListener('click', toggleAccordion);

            // Load initial state
            loadAccordionState();
        })
        .catch(error => {
            console.error('Error loading news widget:', error);
        });
});