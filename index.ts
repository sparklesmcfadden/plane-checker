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
    start();
} catch (err) {
    if (err instanceof Error) {
        dbService.logError('plane_tracker', err.message)
            .then(() => emailService.sendEmail('Plane Tracker Error', 'Plane Tracker has thrown an exception. Check logs.'))
    }
}

let tryCount = 0;
async function start() {
    tryCount++;
    planeTrackerService.startTracker().catch(async e => {
        await dbService.logError('plane_tracker', e);
        if (tryCount < 11) {
            await start();
        } else {
            await dbService.logError('plane_tracker', 'Retry count exceeded; shutting down')
        }
    });
}