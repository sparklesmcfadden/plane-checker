import nodemailer from "nodemailer";
import {DatabaseService} from "./database-service";

export class EmailService {
    constructor(private dbService: DatabaseService) {}

    async sendEmail(subject: string, text: string) {
        const smtpTransport = nodemailer.createTransport({
            service: "Gmail",
            auth: {
                user: process.env.GMAILADDR,
                pass: process.env.GMAILPASS
            }
        });
        const mailOptions = {
            from: process.env.GMAILADDR,
            to: process.env.TARGETEMAIL,
            subject: subject,
            text: text
        };
        smtpTransport.sendMail(mailOptions, async (error) => await this.handleError(error));
    }

    async handleError(error: Error | null) {
        if (error) {
            await this.dbService.logError('sendMail', error.message);
        }
    }
}