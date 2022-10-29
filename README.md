# plane-checker

Uses the adsb local traffic api. during daylight hours, pulls all planes within 25 miles of a lat/lon and reports back when interesting ones appear.

initial setup

create table options
(
    type       varchar(32),
    int_value  integer,
    str_value  varchar(255),
    date_value date
);

insert into "options" ("type", "int_value") values ('request_count', 0);
insert into "options" ("type", "str_value") values ('type_code', <intersting type code - B25, DC3, etc>); -- as many of these as you want

.env file with 

KEY= <your rapid-api key>
DBHOST= <database host>
DBPORT= <database port>
DBLOGIN= <database login>
DBPASS= <database password>
DBNAME= <database name>
LAT= <latitude>
LON= <longitude>
GMAILADDR= <gmail address to send from>
GMAILPASS= <gmail token>
TARGETEMAIL= <address to send emails to>
