function timestamp() {
    return new Date().toISOString();
}

function log(writer, scope, message, meta) {
    const line = `[${timestamp()}] [${scope}] ${message}`;
    if (meta !== undefined) writer(line, meta);
    else writer(line);
}

function info(scope, message, meta) {
    log(console.log, scope, message, meta);
}

function warn(scope, message, meta) {
    log(console.warn, scope, message, meta);
}

function error(scope, message, meta) {
    log(console.error, scope, message, meta);
}

module.exports = { info, warn, error };
