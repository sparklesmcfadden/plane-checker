import { config } from 'dotenv';
import { DatabaseService } from "./services/database-service";
import { EmailService } from "./services/email-service";
import { SettingsService } from "./services/settings-service";
import { PlaneTrackerService } from "./services/plane-tracker-service";

config();

let settingsService = new SettingsService();
let dbService = new DatabaseService(settingsService);
let emailService = new EmailService(dbService);
let planeTrackerService = new PlaneTrackerService(dbService, settingsService, emailService);

try {
    planeTrackerService.startTracker();
} catch (err) {
    if (err instanceof Error) {
        dbService.logError('plane_tracker', err.message)
            .then(() => emailService.sendEmail('Plane Tracker Error', 'Plane Tracker has thrown an exception. Check logs.'))
    }
}