# plane-checker

Uses the adsb local traffic api on rapidapi: https://rapidapi.com/adsbx/api/adsbx-flight-sim-traffic/

during daylight hours, pulls all planes within 25 miles of a lat/lon and reports back when interesting ones appear.

initial setup

```
create database planetracker
```


.env file with 

```
KEY= <your rapid-api key>
DBHOST= <database host>
DBPORT= <database port>
DBLOGIN= <database login>
DBPASS= <database password>
DBNAME= <database name - planetracker, or whatever you used>
LAT= <latitude>
LON= <longitude>
GMAILADDR= <gmail address to send from>
GMAILPASS= <gmail token>
TARGETEMAIL= <address to send emails to>
```

on initial run it creates all the tables it needs. then you can do however many of thes you want

```
insert into settings (setting_type, setting_value) values ('type_code', <intersting type code - B25, DC3, etc>);
insert into settings (setting_type, setting_value) values ('reg_num', <aircraft registration number>);
```
