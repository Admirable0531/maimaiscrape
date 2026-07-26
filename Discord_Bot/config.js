module.exports = {
    MONGO_URI: 'mongodb://mongodb:27017/mydatabase',
    // 'ryan' = main user (ryan_top); rest = friendIdx from link (friend_<id>_top)
    users: ['ryan', '6020500221031', '8071982688053', '8085423055111', '8070962675681', '8091021494559'],
    dailyScoreChannelID: '1233678655717118022',
    checkConstant: ['klcc', 'marcus', 'yuan', 'keyang', 'yuchen', 'jerry', 'kok'],
    idxMap: {
        klcc: '4039890368767',
        yuchen: '6020500221031',
        marcus: '8071982688053',
        kok: '8085423055111',
        yuan: '8070962675681',
        keyang: '8091021494559',
        jerry: '6028368715803',
    },
    // credentials used by friends_webhook.js to login and read friend ratings
    MAIMAI_ACCOUNT_RATING_FY: 'azushinosawa',
    MAIMAI_ACCOUNT_RATING_MAIN: 'blazerod1234',
    // MAIMAI_ACCOUNT_RATING: 'blazerod1234',
    MAIMAI_PASSWORD_RATING: 'ryan1133',
    // optional: Discord webhook for friend rating report
    FRIEND_WEBHOOK_URL_TEST: 'https://discord.com/api/webhooks/1483475595773083761/w2-O6lg_qovOqDmRdtwqoGV48av1u9GRzyix_1oseLJcCxol9dvKrJRPwPOPqcIKVq8b',
    FRIEND_WEBHOOK_URL_FY: 'https://discord.com/api/webhooks/1483814662247289043/rstCwfiJnzAlOs4jKIyvUlUAA-kA8WXvB6Lv7ASshJqRoeVvnQJCaH1-BIZepEzwK0s1',
    // Circle ranking webhook (using test webhook for now)
    CIRCLE_WEBHOOK_URL: 'https://discord.com/api/webhooks/1489156168130498671/Qp3J78vLVfXWz-2PkwetpWeC1cvs4-ts7YMkBbgA8tShdlCjGT7FsTC3ehQLQVXNaiVa',
};
