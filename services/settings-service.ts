export class SettingsService {
    lat: string;
    lon: string;
    sunrise: Date = new Date();
    sunset: Date = new Date();
    setByFallback: boolean = false;
    requestCount: number = 0;
    currentDay = new Date().getDate();
    frequency = 5 * 60000; // 5 minutes

    constructor() {
        this.setDefaultDay();
        this.lat = process.env.LAT || '44.887988';
        this.lon = process.env.LON || '-93.221606';
    }

    setRequestCount(count: number) {
        this.requestCount = count;
    }

    setFrequency(minutes: number) {
        if (minutes * 60000 !== this.frequency) {
            this.frequency = minutes * 60000;
            return true;
        }
        return false;
    }

    checkRequests() {
        if (this.requestCount <= 25) {
            return this.setFrequency(4 * 60); // 4 hours
        } else if (this.requestCount <= 200) {
            return this.setFrequency(30); // 30 minutes
        } else {
            return this.setFrequency(5) // 5 minutes
        }
    }

    setDefaultDay() {
        this.sunset = new Date();
        this.sunset.setHours(20, 0, 0);
        this.sunrise = new Date();
        this.sunrise.setHours(9, 0, 0);
        this.setByFallback = true;
    }

    setDay(sunrise: Date, sunset: Date) {
        this.setByFallback = false;
        this.sunrise = sunrise;
        this.sunset = sunset;
    }

    updateCurrentDay() {
        const newDate = new Date().getDate();
        if (newDate < this.currentDay) {
            // reset frequency if it is a new month
            this.setFrequency(5);
        }
        this.currentDay = new Date().getDate();
    }
}