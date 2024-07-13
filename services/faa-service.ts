import {DatabaseService} from "./database-service";
import * as fs from "fs";
import axios, {AxiosRequestConfig} from "axios";
import AdmZip from "adm-zip";
import * as path from "path";
import {from} from "pg-copy-streams";

export class FaaService {
    initialRun = true;

    constructor(private dbService: DatabaseService) {
    }

    async loadFaaData() {
        const lastLoadDate = await this.dbService.getLastFaaLoadDate();
        const oneYearAgo = new Date(new Date().setFullYear(new Date().getFullYear() - 1));
        if (lastLoadDate < oneYearAgo) {
            await this.setupRegistrationTables();
            if (!this.checkDoesFileExist('MASTER') || !this.checkDoesFileExist('ACFTREF')) {
                await this.getFaaData();
            }
            await this.loadFileToDb('MASTER', 'aircraft_registration');
            await this.loadFileToDb('ACFTREF', 'aircraft_reference');
            await this.dbService.setFaaLoadDate();
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
        try {
            const response = await axios.request(options);
            this.unzipFile(response.data, 'temp')
        } catch (e) {
            await this.dbService.logError('faaService', 'Failed to retrieve FAA data');
        }
    }

    unzipFile(file: any, path: string) {
        const zip = new AdmZip(file);
        zip.extractAllTo(path);
    }

    checkDoesFileExist(fileName: string) {
        const filePath = path.join(`temp/${fileName}.txt`);
        return fs.existsSync(filePath);
    }

    async loadFileToDb(fileName: string, tableName: string) {
        const inputFile = path.join(`temp/${fileName}.txt`);
        const dbStream = this.dbService.client.query(from(`COPY ${tableName} FROM STDIN (NULL "NULL", DELIMITER ',', FORMAT CSV, HEADER);`))
        const fileStream = fs.createReadStream(inputFile);

        fileStream.on('error', async (error) => await this.dbService.logError(`file_read-${fileName}`, error.message));
        dbStream.on('error', async (error) => await this.dbService.logError(`db_copy-${tableName}`, error.message));
        fileStream.on('end', async () => {
            await this.dbService.logMessage('faaDataLoad', 'Data load successful');
        });
        await fileStream.pipe(dbStream);
    }

    async setupRegistrationTables() {
        const registrationTableQuery = () => {
            return {
                text: `create table aircraft_registration
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

        if (!(await this.dbService.checkIfTableExists('aircraft_registration'))) {
            await this.dbService.client.query(registrationTableQuery());
        }
        const dropTablesQuery = {
            text: `drop table if exists aircraft_reference; truncate table aircraft_registration`
        };
        await this.dbService.client.query(dropTablesQuery);
        await this.dbService.client.query(referenceTableQuery);
    }
}