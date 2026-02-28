
/**
 * Add listeners for achievement UI interactions
 */
addAchievementListeners() {
    const containers = document.querySelectorAll('.activity-row-container');

    containers.forEach(container => {
        const toggleBtn = container.querySelector('.toggle-achievement-btn');
        const panel = container.querySelector('.activity-achievement-panel');
        const typeSelect = container.querySelector('.achievement-type-select');
        const participantsContainer = container.querySelector('.achievement-participants-container');

        // Toggle Panel
        if (toggleBtn && panel) {
            toggleBtn.addEventListener('click', () => {
                const isHidden = panel.classList.contains('hidden');
                if (isHidden) {
                    panel.classList.remove('hidden');
                    toggleBtn.classList.add('active');
                } else {
                    panel.classList.add('hidden');
                    toggleBtn.classList.remove('active');
                    // Clear values when hiding? Maybe not, keep state until saved.
                }
            });
        }

        // Toggle Participants based on Type
        if (typeSelect && participantsContainer) {
            typeSelect.addEventListener('change', (e) => {
                if (e.target.value === 'battue') {
                    participantsContainer.style.display = 'none';
                } else {
                    participantsContainer.style.display = 'block';
                }
            });
        }
    });
}
