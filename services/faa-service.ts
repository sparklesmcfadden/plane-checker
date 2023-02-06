import {DatabaseService} from "./database-service";
import * as fs from "fs";
import axios, {AxiosRequestConfig} from "axios";
import AdmZip from "adm-zip";
import * as path from "path";
import {from} from "pg-copy-streams";
import {SettingsService} from "./settings-service";
import {FaaTable} from "../models";

export class FaaService {
    initialRun = true;

    constructor(private dbService: DatabaseService,
                private settingsService: SettingsService) {
    }

    async loadFaaData() {
        if (this.initialRun || this.settingsService.currentDay === 10) {
            const tableName = await this.dbService.getFaaTable();
            this.settingsService.setFaaTable(tableName);
            await this.setupRegistrationTables(tableName);
            await this.getFaaData();
            await this.loadFileToDb('MASTER', tableName.valueOf());
            await this.loadFileToDb('ACFTREF', 'aircraft_reference');
            await this.dbService.logMessage('faaService', 'FAA data setup complete');
            this.initialRun = false;
        }
    }

    async getFaaData() {
        const options: AxiosRequestConfig = {
            method: 'GET',
            url: `https://registry.faa.gov/database/ReleasableAircraft.zip`,
            responseType: 'arraybuffer',
            headers: {
                'Content-Type': 'application/gzip'
            }
        };
        const response = await axios.request(options);
        const zip = new AdmZip(response.data);
        zip.extractAllTo('temp');
    }

    async loadFileToDb(fileName: string, tableName: string) {
        const inputFile = path.join(`temp/${fileName}.txt`);
        const dbStream = this.dbService.client.query(from(`COPY ${tableName} FROM STDIN (NULL "NULL", DELIMITER ',', FORMAT CSV, HEADER);`))
        const fileStream = fs.createReadStream(inputFile)

        fileStream.on('error', async (error) => await this.dbService.logError(`file_read-${fileName}`, error.message));
        dbStream.on('error', async (error) => await this.dbService.logError(`db_copy-${tableName}`, error.message));
        fileStream.on('end', async () => {
            await this.dbService.logMessage('faaDataLoad', 'Data load successful');
        });
        await fileStream.pipe(dbStream);
    }

    async setupRegistrationTables(tableName: FaaTable) {
        const registrationTableQuery = (table: string) => {
            return {
                text: `create table ${table}
            (
                "N-NUMBER"         text,
                "SERIAL NUMBER"    text,
                "MFR MDL CODE"     text,
                "ENG MFR MDL"      text,
                "YEAR MFR"         text,
                "TYPE REGISTRANT"  text,
                name               text,
                street             text,
                street2            text,
                city               text,
                state              text,
                "ZIP CODE"         text,
                region             text,
                county             text,
                country            text,
                "LAST ACTION DATE" text,
                "CERT ISSUE DATE"  text,
                certification      text,
                "TYPE AIRCRAFT"    text,
                "TYPE ENGINE"      integer,
                "STATUS CODE"      text,
                "MODE S CODE"      text,
                "FRACT OWNER"      text,
                "AIR WORTH DATE"   text,
                "OTHER NAMES(1)"   text,
                "OTHER NAMES(2)"   text,
                "OTHER NAMES(3)"   text,
                "OTHER NAMES(4)"   text,
                "OTHER NAMES(5)"   text,
                "EXPIRATION DATE"  text,
                "UNIQUE ID"        text,
                "KIT MFR"          text,
                "KIT MODEL"        text,
                "MODE S CODE HEX"  text,
                trailer            text
            );`
            }
        }
        const referenceTableQuery = {
            text: `create table aircraft_reference
                (
                    code             text,
                    mfr              text,
                    model            text,
                    "TYPE-ACFT"      text,
                    "TYPE-ENG"       text,
                    "AC-CAT"         text,
                    "BUILD-CERT-IND" text,
                    "NO-ENG"         text,
                    "NO-SEATS"       text,
                    "AC-WEIGHT"      text,
                    speed            text,
                    "TC-DATA-SHEET"  text,
                    "TC-DATA-HOLDER" text,
                    trailer          text
                );`
        }

        if (!(await this.dbService.checkIfTableExists('aircraft_registration_green'))) {
            await this.dbService.client.query(registrationTableQuery('aircraft_registration_green'));
        }
        if (!(await this.dbService.checkIfTableExists('aircraft_registration_blue'))) {
            await this.dbService.client.query(registrationTableQuery('aircraft_registration_blue'));
        }
        const dropTablesQuery = {
            text: `drop table if exists aircraft_reference; truncate table ${tableName.valueOf()}`
        };
        await this.dbService.client.query(dropTablesQuery);
        await this.dbService.client.query(referenceTableQuery);
    }
}