import {config} from 'dotenv';
import {DatabaseService} from "./services/database-service";
import {EmailService} from "./services/email-service";
import {SettingsService} from "./services/settings-service";
import {OpenSkiesService} from "./services/open-skies-service";
import {AdsbService} from "./services/adsb-service";
import {FaaService} from "./services/faa-service";
import {SetupService} from "./services/setup-service";

config();

const settingsService = new SettingsService();
const dbService = new DatabaseService();
const emailService = new EmailService(dbService);
const setupService = new SetupService(dbService, settingsService);
const faaService = new FaaService(dbService, settingsService);
const adsbService = new AdsbService(dbService, emailService, settingsService);
const openSkiesService = new OpenSkiesService(dbService, emailService, settingsService);

async function start() {
    await setupService.setupTables();
    await setupService.getSunriseSunset();

    settingsService.setRequestCount(await dbService.getRequestCount());
    let messageText = `Plane Tracker is running. ${settingsService.requestCount} requests remaining.`
    await dbService.logMessage('startTracker', messageText);

    await run();
}

async function run() {
    await setupService.updateSunriseSunset();
    await setupService.updateNotables();
    await faaService.loadFaaData();
    await adsbService.checkLocalAdsbTraffic();
    await openSkiesService.getStatesByHex();

    setTimeout(async () => {
        await run();
    }, settingsService.interval);
}

try {
    start().catch(e => dbService.logError('plane_tracker', e));
} catch (err) {
    if (err instanceof Error) {
        dbService.logError('plane_tracker', err.message)
    }
}

export async function sleep(min: number) {
    return new Promise(resolve => setTimeout(resolve, min * 60000));
}