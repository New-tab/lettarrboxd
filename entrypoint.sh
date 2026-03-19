#!/bin/sh
set -e

chown -R seerrboxd:seerrboxd /data

exec su-exec seerrboxd "$@"
