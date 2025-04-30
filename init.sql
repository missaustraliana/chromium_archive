create table chromium
(
	build         integer                           not null
			constraint chromium_pk
					primary key,
	build_date integer not null,
    created_date integer default current_timestamp not null,
    chromium_version      TEXT                              not null,
    filename     TEXT                              not null,
    filesize    integer                           not null,
    sha1     TEXT                              not null,
    is_uploaded integer default 0 not null
);


--create index chromium_index
--	on chromium (ecid);
