/**
 * @const {object} CONF
 */
const CONF = require('../conf.json');

/**
 * @const {pg.Client} Client
 */
const {Client} = require('pg');

/**
 * @class WavesSlackRewardBot.Storage
 *
 * @see https://node-postgres.com/
 */
class Self {

    /**
     * @static
     * @const {string} SQL_GET_WALLET_ID
     */
    static get SQL_GET_WALLET_ID() {
        return `
            SELECT
                slack_id,
                wallet_phrase,
                wallet_address
            FROM
                ${CONF.DB.WALLETS_TABLE_NAME}
            WHERE
                slack_id = $1
            LIMIT
                1
        `;
    }

    /**
     * @static
     * @const {string} SQL_GET_WALLETS_IDS
     */
    static get SQL_GET_WALLETS_IDS() {
        return `
            SELECT
                slack_id,
                wallet_phrase,
                wallet_address
            FROM
                ${CONF.DB.WALLETS_TABLE_NAME}
            WHERE
                slack_id = $1
            OR
                slack_id = $2
            LIMIT
                2
        `;
    }

    /**
     * @static
     * @const {string} SQL_ADD_TRANSACTION
     */
    static get SQL_ADD_TRANSACTION() {
        return `
            INSERT INTO ${CONF.DB.TRANSACTIONS_TABLE_NAME} (
                emitent_id,
                recipient_id,
                transaction_hash,
                transaction_date,
                transaction_amount
            ) VALUES (
                $1,
                $2,
                $3,
                $4,
                $5
            )
        `;
    }

    /**
     * @static
     * @const {string} SQL_GET_ALL_RECIPIENTS
     */
    static get SQL_GET_ALL_RECIPIENTS() {
        return `
            SELECT
                ${CONF.DB.TRANSACTIONS_TABLE_NAME}.recipient_id,
                sum(${CONF.DB.TRANSACTIONS_TABLE_NAME}.transaction_amount) AS transaction_amount,
                max(${CONF.DB.TRANSACTIONS_TABLE_NAME}.transaction_date) AS transaction_date,
                max(${CONF.DB.WALLETS_TABLE_NAME}.wallet_address) AS wallet_address
            FROM
                ${CONF.DB.TRANSACTIONS_TABLE_NAME}
            LEFT JOIN 
                ${CONF.DB.WALLETS_TABLE_NAME}
            ON
                ${CONF.DB.WALLETS_TABLE_NAME}.slack_id = ${CONF.DB.TRANSACTIONS_TABLE_NAME}.recipient_id
            GROUP BY
                ${CONF.DB.TRANSACTIONS_TABLE_NAME}.recipient_id
            ORDER BY
                transaction_amount DESC,
                transaction_date DESC
        `;
    }

    /**
     * @static
     * @const {string} SQL_GET_TOP_RECIPIENTS
     */
    static get SQL_GET_TOP_RECIPIENTS() {
        return `
            SELECT
                ${CONF.DB.TRANSACTIONS_TABLE_NAME}.recipient_id,
                sum(${CONF.DB.TRANSACTIONS_TABLE_NAME}.transaction_amount) AS transaction_amount,
                max(${CONF.DB.TRANSACTIONS_TABLE_NAME}.transaction_date) AS transaction_date,
                max(${CONF.DB.WALLETS_TABLE_NAME}.wallet_address) AS wallet_address
            FROM
                ${CONF.DB.TRANSACTIONS_TABLE_NAME}
            LEFT JOIN 
                ${CONF.DB.WALLETS_TABLE_NAME}
            ON
                ${CONF.DB.WALLETS_TABLE_NAME}.slack_id = ${CONF.DB.TRANSACTIONS_TABLE_NAME}.recipient_id
            WHERE
                transaction_date >= $1
            GROUP BY
                ${CONF.DB.TRANSACTIONS_TABLE_NAME}.recipient_id
            ORDER BY
                transaction_amount DESC,
                transaction_date DESC
        `;
    }

    static get SQL_CREATE_USER() {
        return `
            INSERT INTO ${CONF.DB.WALLETS_TABLE_NAME} (
                slack_id,
                wallet_phrase,
                wallet_address,
                wallet_created
            ) VALUES(
                $1,
                $2,
                $3,
                $4
            )
        `;
    }

    /**
     * @static
     * @const {string} SQL_GET_ALL_USERS_IDS
     */
    static get SQL_GET_ALL_USERS_IDS() {
        return `
            SELECT
                slack_id
            FROM
                ${CONF.DB.WALLETS_TABLE_NAME}
        `;
    }

    /**
     * @constructor
     *
     * @param {object} args
     */
    constructor(args) {
        // Set error handler
        this._error = args.error;

        // Set link to global event emitter
        this._event = args.event;

        // Bind some methods to the current context
        this._route = this._route.bind(this);

        // Add event handlers
        this._live();

        // Get link to DB client
        this._client = new Client(CONF.DB);

        // Make DB connection
        this._connect()
    }

    /**
     * @private
     * @method _live
     */
    _live() {
        // Modules events
        this._event.sub(this._event.EVENT_SLACK_WAVES_GRANTED, this._route);
        this._event.sub(this._event.EVENT_SLACK_ALL_REQUESTED, this._route);
        this._event.sub(this._event.EVENT_SLACK_TOP_REQUESTED, this._route);
        this._event.sub(this._event.EVENT_SLACK_SEED_REQUESTED, this._route);
        this._event.sub(this._event.EVENT_SLACK_STAT_REQUESTED, this._route);
        this._event.sub(this._event.EVENT_SLACK_ADDRESS_REQUESTED, this._route);
        this._event.sub(this._event.EVENT_SLACK_BALANCE_REQUESTED, this._route);
        this._event.sub(this._event.EVENT_SLACK_UPDATE_WALLETS_REQUESTED, this._route);
        this._event.sub(this._event.EVENT_NODE_WALLETS_CREATED, this._route);
        this._event.sub(this._event.EVENT_NODE_REQUEST_SUCCEEDED, this._route);
    }

    /**
     * @private
     * @method _route
     *
     * @param {Event} event
     */
    _route(event) {
        // No need to go further
        if (!event || !event.type) {
            return;
        }

        switch (event.type) {

            // Check if wallets exist and send transaction request
            case this._event.EVENT_SLACK_WAVES_GRANTED:
                this._checkWallets(event.data);
                break;

            //
            case this._event.EVENT_SLACK_ALL_REQUESTED:
                this._getStatAll(event.data);
                break;

            //
            case this._event.EVENT_SLACK_TOP_REQUESTED:
                this._getStatTop(event.data);
                break;

            // 
            case this._event.EVENT_SLACK_SEED_REQUESTED:
                this._getMySeed(event.data);
                break;

            //
            case this._event.EVENT_SLACK_STAT_REQUESTED:
                this._getStat(event.data);
                break;

            // 
            case this._event.EVENT_SLACK_ADDRESS_REQUESTED:
                this._getMyAddress(event.data);
                break;

            // Check if wallet exist and send balance request
            case this._event.EVENT_SLACK_BALANCE_REQUESTED:
                this._getMyBalance(event.data);
                break;

            // 
            case this._event.EVENT_NODE_WALLETS_CREATED:
                this._createNewUsers(event.data);
                break;

            // Save transaction info
            case this._event.EVENT_NODE_REQUEST_SUCCEEDED:
                if (event.data.transfer) {
                    this._addTransaction(event.data);
                }
                break;

            //
            case this._event.EVENT_SLACK_UPDATE_WALLETS_REQUESTED:
                this._getUsersWithoutWallets(event.data);
                break;

        }
    }

    /**
     * @private
     * @method _request
     *
     * @param {string} text
     * @param {Array} values
     * @param {string} rowMode
     */
    _request(text, values = [], rowMode = '') {
        // No need to go further
        if (!text) {
            return null;
        }

        return this._client.query({
            text,
            values,
            rowMode
        }).catch(this._error);
    }

    /**
     * @async
     * @private
     * @method _connect
     *
     * @fires this._event.EVENT_STORAGE_CONNECTED
     * @fires this._event.EVENT_STORAGE_NOT_CONNECTED
     */
    async _connect() {
        await this._client.connect(
            () => {this._event.pub(this._event.EVENT_STORAGE_CONNECTED)},
            (exc) => {this._event.pub(this._event.EVENT_STORAGE_NOT_CONNECTED, exc)}
        );
    }

    /**
     * @async
     * @private
     * @method _getStatTop
     *
     * @param {object} data
     *
     * @fires this._event.EVENT_STORAGE_STAT_REQUEST_FAILED
     * @fires this._event.EVENT_STORAGE_STAT_REQUEST_SUCCEEDED
     */
    async _getStat(data) {
        var
            list = null;

        switch (data.stat.alias) {

            // Total balances
            case 'balances':
                list = await this._getStatBalances(data);
                break;

            // Montly banalce
            default:
                data.stat.alias = 'month';
                list = await this._getStatMonth(data);
                break;
        }

        // No need to go further
        if (!list) {
            this._event.pub(this._event.EVENT_STORAGE_STAT_REQUEST_FAILED, data);
            return;
        }

        data.stat.list = list;

        this._event.pub(this._event.EVENT_STORAGE_STAT_REQUEST_SUCCEEDED, data);
    }

    /**
     * @async
     * @private
     * @method _getStatMonth
     *
     * @param {object} data
     *
     * @returns {object}
     */
    async _getStatMonth(data) {
        var
            date = new Date(),
            stat = null;

        // Move date to the very beginning of current month
        date.setDate(1);
        date.setHours(0);
        date.setMinutes(0);
        date.setSeconds(0);

        // Make request
        stat = await this._request(
                   Self.SQL_GET_TOP_RECIPIENTS,
                   [date],
                   'array'
               ).catch(this._error);

        // No need to go further
        if (!stat || !stat.rowCount) {
            return null;
        }

        return stat.rows;
    }

    /**
     * @async
     * @private
     * @method _getStatBalances
     *
     * @param {object} data
     *
     * @returns {object}
     */
    async _getStatBalances(data) {
        var
            // Make request
            stat = await this._request(
                       Self.SQL_GET_ALL_RECIPIENTS,
                       [],
                       'array'
                   ).catch(this._error);

        // No need to go further
        if (!stat || !stat.rowCount) {
            return null;
        }

        return stat.rows;
    }

    /**
     * @async
     * @private
     * @method _getStatAddress
     *
     * @param {object} data
     *
     * @fires this._event.EVENT_STORAGE_SEED_REQUEST_FAILED
     * @fires this._event.EVENT_STORAGE_SEED_REQUEST_SUCCEEDED
     */
    async _getMySeed(data) {
        var
            wallet = await this._checkWallet(data);

        // No need to go further
        if (!wallet) {
            this._event.pub(this._event.EVENT_STORAGE_SEED_REQUEST_FAILED, data);
            return;
        }

        // Set emitent address
        data.emitent.seed = wallet[1];

        //
        this._event.pub(this._event.EVENT_STORAGE_SEED_REQUEST_SUCCEEDED, data);
    }

    /**
     * @async
     * @private
     * @method _getStatAddress
     *
     * @param {object} data
     *
     * @fires this._event.EVENT_STORAGE_ADDRESS_REQUEST_SUCCEDED
     */
    async _getMyAddress(data) {
        var
            wallet = await this._checkWallet(data);

        // No need to go further
        if (!wallet) {
            this._event.pub(this._event.EVENT_STORAGE_ADDRESS_REQUEST_FAILED, data);
            return;
        }

        // Set emitent address
        data.emitent.address = wallet[2];

        //
        this._event.pub(this._event.EVENT_STORAGE_ADDRESS_REQUEST_SUCCEDED, data);
    }

    /**
     * @async
     * @private
     * @method _getStatBalance
     *
     * @param {object} data
     *
     * @fires this._event.EVENT_STORAGE_REQUEST_BALANCE
     */
    async _getMyBalance(data) {
        var
            wallet = await this._checkWallet(data);

        // No need to go further
        if (!wallet) {
            return;
        }

        // Set emitent address
        data.emitent.address = wallet[2];

        // 
        this._event.pub(this._event.EVENT_STORAGE_REQUEST_BALANCE, data);
    }


    /**
     * @async
     * @private
     * @method _checkWallets
     *
     * @param {object} data
     *
     * @fires this._event.EVENT_STORAGE_NO_WALLET
     *
     * @returns {object}
     */
    async _checkWallet(data) {
        var
            id = (data.recipient ? data.recipient.id : data.emitent.id),
            wallet = await this._request(
                          Self.SQL_GET_WALLET_ID,
                          [id],
                          'array'
                      ).catch(this._error);

        // No need to go further
        if (!wallet || !wallet.rowCount) {
            this._event.pub(this._event.EVENT_STORAGE_NO_WALLET, data);
            return null;
        }

        return wallet.rows[0];
    }

    /**
     * @async
     * @private
     * @method _checkWallets
     *
     * @param {object} data
     *
     * @fires this._event.EVENT_STORAGE_NO_WALLETS
     * @fires this._event.EVENT_STORAGE_NO_EMITTER_WALLET
     * @fires this._event.EVENT_STORAGE_NO_RECIPIENT_WALLET
     * @fires this._event.EVENT_STORAGE_TRANSFER_WAVES
     */
    async _checkWallets(data) {
        var
            wallets = await this._request(
                          Self.SQL_GET_WALLETS_IDS,
                          [data.emitent.id, data.recipient.id],
                          'array'
                      ).catch(this._error);

        // No need to go further
        if (!wallets || !wallets.rowCount) {
            this._event.pub(this._event.EVENT_STORAGE_NO_WALLETS, data);
            return;
        }

        // Add address and keyphrase
        wallets.rows.forEach((row) => {
            if (row[0] == data.emitent.id) {
                data.emitent.phrase = row[1];
            } else if (row[0] == data.recipient.id) {
                data.recipient.address = row[2];
            }
        });

        // No need to go further
        if (!data.emitent.phrase) {
            this._event.pub(this._event.EVENT_STORAGE_NO_EMITTER_WALLET, data);
            return;
        } else if (!data.recipient.address) {
            this._event.pub(this._event.EVENT_STORAGE_NO_RECIPIENT_WALLET, data);
            return;
        }

        this._event.pub(this._event.EVENT_STORAGE_TRANSFER_WAVES, data);
    }

    /**
     * @async
     * @private
     * @method _createNewUsers
     *
     * @param {object} data
     *
     * @fires this._event.EVENT_STORAGE_CREATED_NEW_WALLETS
     */
    async _createNewUsers(data) {
        var
            created = new Date();

        // Send requests
        data.update.users.forEach(async (item) => {
            this._request(
                Self.SQL_CREATE_USER,
                [
                    item.slack_id,
                    item.wallet_phrase,
                    item.wallet_address,
                    created
                ],
                'array'
            );
        });

        // 
        this._event.pub(this._event.EVENT_STORAGE_CREATED_NEW_WALLETS, data);
    }

    /**
     * @async
     * @private
     * @method _getUsersWithoutWallets
     *
     * @param {object} data
     *
     * @fires this._event.EVENT_STORAGE_CREATE_NEW_WALLETS
     */
    async _getUsersWithoutWallets(data) {
        var
            users = await this._request(
                        Self.SQL_GET_ALL_USERS_IDS,
                        [],
                        'array'
                    ).catch(this._error);

        // No need to go further
        if (!users || !users.rowCount) {
            return;
        }

        // Get users ids list from rows
        users = users.rows.map((row) => {
            return row[0];
        });

        // Filter users with wallets
        data.update.users = data.update.users.filter((uid) => {
            if (users.indexOf(uid) === -1) {
                return true;
            }

            return false;
        });

        this._event.pub(this._event.EVENT_STORAGE_CREATE_NEW_WALLETS, data);
    }

    /**
     * @async
     * @private
     * @method _addTransaction
     *
     * @param {object} data
     *
     * @fires this._event.EVENT_STORAGE_TRANSFER_NOT_COMPLETED
     * @fires this._event.EVENT_STORAGE_TRANSFER_COMPLETED
     */
    async _addTransaction(data) {
        var
            res = await this._request(
                      Self.SQL_ADD_TRANSACTION,
                      [
                           data.emitent.id,
                           data.recipient.id,
                           data.transfer.id,
                           new Date(),
                           data.transfer.amount
                      ]
                  ).catch(this._error);

        // No need to go further
        if (!res || !res.rowCount) {
            this._event.pub(this._event.EVENT_STORAGE_TRANSFER_NOT_COMPLETED, data);
            return;
        }

        this._event.pub(this._event.EVENT_STORAGE_TRANSFER_COMPLETED, data);
    }

}

/**
 * @exports WavesSlackRewardBot.Storage
 */
module.exports = Self;
