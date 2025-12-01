/**
 * DateManager - Handles date navigation and meeting date calculations
 * for the Preparation Reunions page
 */
export class DateManager {
        constructor(organizationSettings) {
                this.organizationSettings = organizationSettings;
                this.availableDates = [];
                this.currentDate = null;
        }

        /**
         * Set available dates
         */
        setAvailableDates(dates) {
                // Convert ISO date strings to plain dates and ensure they're strings
                this.availableDates = dates.map(d => typeof d === 'string' && d.includes('T') ? d.split('T')[0] : d);
                if (this.availableDates.length > 0) {
                        this.currentDate = this.availableDates[0];
                } else {
                        this.currentDate = this.getNextMeetingDate();
                        this.availableDates.push(this.currentDate);
                }
        }

        /**
         * Get the next meeting date based on organization settings
         */
        getNextMeetingDate() {
                const today = new Date();
                const meetingDay = this.organizationSettings.organization_info?.meeting_day || 'Tuesday';
                const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                const meetingDayIndex = daysOfWeek.indexOf(meetingDay);
                const todayIndex = today.getDay();

                // Calculate days until the next meeting day
                let daysUntilNextMeeting = (meetingDayIndex - todayIndex + 7) % 7;

                // If today is the meeting day and it's after 8 PM, set the next meeting to the following week
                if (daysUntilNextMeeting === 0 && today.getHours() >= 20) {
                        daysUntilNextMeeting = 7;
                }

                const nextMeeting = new Date(today);
                nextMeeting.setDate(today.getDate() + daysUntilNextMeeting);

                // Construct the date string in 'YYYY-MM-DD' format
                const year = nextMeeting.getFullYear();
                const month = String(nextMeeting.getMonth() + 1).padStart(2, '0');
                const day = String(nextMeeting.getDate()).padStart(2, '0');

                return `${year}-${month}-${day}`;
        }

        /**
         * Format date for display
         */
        formatDate(dateString, lang) {
                const [year, month, day] = dateString.split('-').map(Number);
                const date = new Date(year, month - 1, day);

                const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
                return date.toLocaleDateString(lang, options);
        }

        /**
         * Create a new meeting date (next occurrence of the meeting day after current date)
         */
        createNewMeetingDate() {
                let newDate;

                if (this.currentDate) {
                        // Calculate the next occurrence of the meeting day AFTER the current date
                        const currentMeetingDate = new Date(this.currentDate);
                        const meetingDay = this.organizationSettings.organization_info?.meeting_day || 'Tuesday';
                        const daysOfWeek = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
                        const meetingDayIndex = daysOfWeek.indexOf(meetingDay);
                        const currentDayIndex = currentMeetingDate.getDay();

                        // Calculate days until next meeting day (always at least 7 days from current)
                        let daysUntilNextMeeting = (meetingDayIndex - currentDayIndex + 7) % 7;
                        if (daysUntilNextMeeting === 0) {
                                daysUntilNextMeeting = 7; // If current date is the meeting day, go to next week
                        }

                        const nextMeeting = new Date(currentMeetingDate);
                        nextMeeting.setDate(currentMeetingDate.getDate() + daysUntilNextMeeting);

                        const year = nextMeeting.getFullYear();
                        const month = String(nextMeeting.getMonth() + 1).padStart(2, '0');
                        const day = String(nextMeeting.getDate()).padStart(2, '0');
                        newDate = `${year}-${month}-${day}`;
                } else {
                        // If no current date, use next meeting date
                        newDate = this.getNextMeetingDate();
                }

                if (!this.availableDates.includes(newDate)) {
                        this.availableDates.push(newDate);
                        this.availableDates.sort((a, b) => new Date(a) - new Date(b));
                }
                this.currentDate = newDate;
                return newDate;
        }

        /**
         * Navigate to a specific meeting (by offset from current)
         */
        navigateMeeting(direction) {
                const currentIndex = this.availableDates.indexOf(this.currentDate);
                const newIndex = currentIndex + direction;
                if (newIndex >= 0 && newIndex < this.availableDates.length) {
                        this.currentDate = this.availableDates[newIndex];
                        return this.currentDate;
                } else if (direction > 0) {
                        return this.createNewMeetingDate();
                }
                return null;
        }

        /**
         * Get current date
         */
        getCurrentDate() {
                return this.currentDate;
        }

        /**
         * Set current date
         */
        setCurrentDate(date) {
                this.currentDate = date;
        }

        /**
         * Get available dates
         */
        getAvailableDates() {
                return this.availableDates;
        }
}
