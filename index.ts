import { config } from 'dotenv';
import { DatabaseService } from "./services/database-service";
import { EmailService } from "./services/email-service";
import { SettingsService } from "./services/settings-service";
import { PlaneTrackerService } from "./services/plane-tracker-service";

config();

const settingsService = new SettingsService();
const dbService = new DatabaseService(settingsService);
const emailService = new EmailService(dbService);
const planeTrackerService = new PlaneTrackerService(dbService, settingsService, emailService);

let tryCount = 0;
async function start() {
    planeTrackerService.startTracker().catch(async e => {
        await dbService.logError('plane_tracker', e);
        if (tryCount < 10) {
            tryCount++;
            await dbService.logMessage('plane_tracker', `Retrying. Attempt ${tryCount}.`)
            await sleep(2);
            await start();
        } else {
            await dbService.logError('plane_tracker', 'Retry count exceeded; shutting down')
        }
    });
}

try {
    start().catch(e => dbService.logError('plane_tracker', e));
} catch (err) {
    if (err instanceof Error) {
        dbService.logError('plane_tracker', err.message)
            .then(() => emailService.sendEmail('Plane Tracker Error', 'Plane Tracker has thrown an exception. Check logs.'))
    }
}

export async function sleep(min: number) {
    return new Promise(resolve => setTimeout(resolve, min * 60000));
}