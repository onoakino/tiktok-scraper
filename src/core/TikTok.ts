/* eslint-disable no-throw-literal */
/* eslint-disable no-await-in-loop */
import rp, { OptionsWithUri } from 'request-promise';
import { tmpdir } from 'os';
import { writeFile, readFile, mkdir } from 'fs';
import { Parser } from 'json2csv';
import ora, { Ora } from 'ora';
import { fromCallback } from 'bluebird';
import { EventEmitter } from 'events';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { forEachLimit } from 'async';

import CONST from '../constant';

import { generateSignature } from '../helpers';

import {
    PostCollector,
    ScrapeType,
    TikTokConstructor,
    Result,
    ItemListData,
    ApiResponse,
    Challenge,
    UserData,
    RequestQuery,
    Item,
    History,
    Proxy,
} from '../types';

import { Downloader } from '../core';

export class TikTokScraper extends EventEmitter {
    private mainHost: string;

    private userAgent: string;

    private download: boolean;

    private filepath: string;

    private json2csvParser: Parser<any>;

    private filetype: string;

    private input: string;

    private proxy: string[] | string;

    private number: number;

    private asyncDownload: number;

    private asyncScraping: () => number;

    private collector: PostCollector[];

    private event: boolean;

    private scrapeType: ScrapeType;

    private cli: boolean;

    private spinner: Ora;

    private byUserId: boolean;

    private storeHistory: boolean;

    private historyPath: string;

    private idStore: string;

    public Downloader: Downloader;

    private tacValue: string = '';

    private storeValue: string = '';

    private maxCursor: number;

    private noWaterMark: boolean;

    private noDuplicates: string[];

    private timeout: number;

    private bulk: boolean;

    private zip: boolean;

    private fileName: string;

    private test: boolean;

    private hdVideo: boolean;

    private signature: string;

    constructor({
        download,
        filepath,
        filetype,
        proxy,
        asyncDownload,
        asyncScraping,
        cli = false,
        event = false,
        progress = false,
        input,
        number,
        type,
        by_user_id = false,
        store_history = false,
        historyPath = '',
        userAgent,
        noWaterMark = false,
        fileName = '',
        timeout = 0,
        bulk = false,
        zip = false,
        test = false,
        hdVideo = false,
        tac = '',
        signature = '',
    }: TikTokConstructor) {
        super();
        this.mainHost = 'https://m.tiktok.com/';
        this.userAgent = userAgent || CONST.userAgent;
        this.download = download;
        this.filepath = process.env.SCRAPING_FROM_DOCKER ? '/usr/app/files' : filepath || '';
        this.fileName = fileName;
        this.json2csvParser = new Parser({ flatten: true });
        this.filetype = filetype;
        this.input = input;
        this.test = test;
        this.proxy = proxy;
        this.number = number;
        this.zip = zip;
        this.hdVideo = hdVideo;
        this.tacValue = tac;
        this.asyncDownload = asyncDownload || 5;
        this.signature = signature;
        this.asyncScraping = (): number => {
            switch (this.scrapeType) {
                case 'user':
                case 'trend':
                    return 1;
                default:
                    return asyncScraping || 3;
            }
        };
        this.collector = [];
        this.event = event;
        this.scrapeType = type;
        this.cli = cli;
        this.spinner = ora('TikTok Scraper Started');
        this.byUserId = by_user_id;
        this.storeHistory = cli && download && store_history;
        this.historyPath = process.env.SCRAPING_FROM_DOCKER ? '/usr/app/files' : historyPath || tmpdir();
        this.idStore = '';
        this.noWaterMark = noWaterMark;
        this.maxCursor = 0;
        this.noDuplicates = [];
        this.timeout = timeout;
        this.bulk = bulk;
        this.Downloader = new Downloader({
            progress,
            proxy,
            noWaterMark,
            userAgent,
            filepath: process.env.SCRAPING_FROM_DOCKER ? '/usr/app/files' : filepath || '',
            bulk,
        });
    }

    /**
     * Get file destination(csv, zip, json)
     */
    private get fileDestination(): string {
        if (this.fileName) {
            return this.filepath ? `${this.filepath}/${this.fileName}` : this.fileName;
        }
        switch (this.scrapeType) {
            case 'user':
            case 'hashtag':
                return this.filepath ? `${this.filepath}/${this.input}_${Date.now()}` : `${this.input}_${Date.now()}`;
            default:
                return this.filepath ? `${this.filepath}/${this.scrapeType}_${Date.now()}` : `${this.scrapeType}_${Date.now()}`;
        }
    }

    /**
     * Get folder destination, where all downloaded posts will be saved
     */
    private get folderDestination(): string {
        switch (this.scrapeType) {
            case 'user':
                return this.filepath ? `${this.filepath}/${this.input}` : this.input;
            case 'hashtag':
                return this.filepath ? `${this.filepath}/#${this.input}` : `#${this.input}`;
            case 'music':
                return this.filepath ? `${this.filepath}/music:${this.input}` : `music:${this.input}`;
            case 'trend':
                return this.filepath ? `${this.filepath}/trend` : `trend`;
            case 'video':
                return this.filepath ? `${this.filepath}/video` : `video`;
            default:
                throw new TypeError(`${this.scrapeType} is not supported`);
        }
    }

    /**
     * Get proxy
     */
    private get getProxy(): Proxy {
        if (Array.isArray(this.proxy)) {
            const selectProxy = this.proxy.length ? this.proxy[Math.floor(Math.random() * this.proxy.length)] : '';
            return {
                socks: false,
                proxy: selectProxy,
            };
        }
        if (this.proxy.indexOf('socks4://') > -1 || this.proxy.indexOf('socks5://') > -1) {
            return {
                socks: true,
                proxy: new SocksProxyAgent(this.proxy as string),
            };
        }
        return {
            socks: false,
            proxy: this.proxy as string,
        };
    }

    /**
     * Main request method
     * @param {} OptionsWithUri
     */
    private request<T>({ uri, method, qs, body, form, headers, json, gzip }: OptionsWithUri): Promise<T> {
        // eslint-disable-next-line no-async-promise-executor
        return new Promise(async (resolve, reject) => {
            const proxy = this.getProxy;
            const query = {
                uri,
                method,
                ...(qs ? { qs } : {}),
                ...(body ? { body } : {}),
                ...(form ? { form } : {}),
                headers: {
                    'User-Agent': this.userAgent,
                    ...headers,
                },
                ...(json ? { json: true } : {}),
                ...(gzip ? { gzip: true } : {}),
                resolveWithFullResponse: true,
                ...(proxy.proxy && proxy.socks ? { agent: proxy.proxy } : {}),
                ...(proxy.proxy && !proxy.socks ? { proxy: `http://${proxy.proxy}/` } : {}),
                timeout: 10000,
            } as OptionsWithUri;
            try {
                const response = await rp(query);
                setTimeout(() => {
                    resolve(response.body);
                }, this.timeout);
            } catch (error) {
                reject(error);
            }
        });
    }

    private returnInitError(error) {
        if (this.cli && !this.bulk) {
            this.spinner.stop();
        }
        if (this.event) {
            this.emit('error', error);
        } else {
            throw error;
        }
    }

    /**
     * Extract new Tac value
     * @param {*} uri
     */
    private async extractTac(uri = 'https://www.tiktok.com/discover') {
        const query = {
            uri,
            method: 'GET',
            headers: {
                accept: 'application/json, text/plain, */*',
                referer: 'https://www.tiktok.com/',
            },
            gzip: true,
        };

        try {
            const response = await this.request<string>(query);
            const tacRegex = /<script>tac='([^]*)'<\/script>/.exec(response);
            if (tacRegex) {
                // eslint-disable-next-line prefer-destructuring
                this.tacValue = tacRegex[1];
            } else {
                throw new TypeError("Can't extract Tac value");
            }
        } catch (error) {
            this.returnInitError(error.message);
        }
    }

    /**
     * Initiate scraping process
     */
    // eslint-disable-next-line consistent-return
    public async scrape(): Promise<Result | any> {
        if (this.cli && !this.bulk) {
            this.spinner.start();
        }

        if (this.download && !this.zip) {
            try {
                await fromCallback(cb => mkdir(this.folderDestination, { recursive: true }, cb));
            } catch (error) {
                return this.returnInitError(error.message);
            }
        }

        if (!this.scrapeType || CONST.scrape.indexOf(this.scrapeType) === -1) {
            return this.returnInitError(`Missing scraping type. Scrape types: ${CONST.scrape} `);
        }
        if (this.scrapeType !== 'trend' && !this.input) {
            return this.returnInitError('Missing input');
        }

        await this.extractTac();

        if (this.tacValue) {
            await this.mainLoop();

            if (this.event) {
                return this.emit('done', 'completed');
            }

            if (this.storeHistory) {
                await this.storeDownlodProgress();
            }

            if (this.noWaterMark) {
                await this.withoutWatermark();
            }

            const [json, csv, zip] = await this.saveCollectorData();

            return {
                collector: this.collector,
                ...(this.download ? { zip } : {}),
                ...(this.filetype === 'all' ? { json, csv } : {}),
                ...(this.filetype === 'json' ? { json } : {}),
                ...(this.filetype === 'csv' ? { csv } : {}),
            };
        }
    }

    /**
     * Extract uniq video id and create the url to the video without the watermark
     */
    private withoutWatermark() {
        return new Promise(resolve => {
            forEachLimit(
                this.collector,
                5,
                (item: PostCollector, cb) => {
                    this.extractVideoId(item.videoUrl)
                        .then(video => {
                            if (video) {
                                // eslint-disable-next-line no-param-reassign
                                item.videoUrlNoWaterMark = video;
                            }
                            cb(null);
                        })
                        .catch(() => cb(null));
                },
                () => {
                    resolve();
                },
            );
        });
    }

    /**
     * Extract uniq video id
     * @param uri
     */
    // eslint-disable-next-line class-methods-use-this
    private async extractVideoId(uri): Promise<string> {
        try {
            const result = await rp({ uri });
            const position = Buffer.from(result).indexOf('vid:');
            if (position !== -1) {
                const id = Buffer.from(result)
                    .slice(position + 4, position + 36)
                    .toString();
                return `https://api2.musical.ly/aweme/v1/playwm/?video_id=${id}${this.hdVideo ? `&improve_bitrate=1&ratio=1080p` : ''}`;
            }
            throw new Error(`Cant extract video id`);
        } catch (error) {
            return '';
        }
    }

    /**
     * Main loop that collects all required metadata from the tiktok web api
     */
    private mainLoop(): Promise<any> {
        return new Promise(resolve => {
            let arrayLength = this.number % 27 ? Math.ceil(this.number / 27) : Math.ceil(this.number / 27) + 1;
            if (!this.number) {
                arrayLength = 1000;
            }
            const taskArray = Array.from({ length: arrayLength }, (v, k) => k + 1);
            forEachLimit(
                taskArray,
                this.asyncScraping(),
                (item, cb) => {
                    switch (this.scrapeType) {
                        case 'user':
                            this.getUserId()
                                .then(query => this.submitScrapingRequest(query, this.maxCursor))
                                .then(() => cb(null))
                                .catch(error => cb(error));
                            break;
                        case 'hashtag':
                            this.getHashTagId()
                                .then(query => this.submitScrapingRequest(query, item === 1 ? 0 : (item - 1) * query.count))
                                .then(() => cb(null))
                                .catch(error => cb(error));
                            break;
                        case 'trend':
                            this.getTrendingFeedQuery()
                                .then(query => this.submitScrapingRequest(query, this.maxCursor))
                                .then(() => cb(null))
                                .catch(error => cb(error));
                            break;
                        case 'music':
                            this.getMusicFeedQuery()
                                .then(query => this.submitScrapingRequest(query, item === 1 ? 0 : (item - 1) * query.count))
                                .then(() => cb(null))
                                .catch(error => cb(error));
                            break;
                        default:
                            break;
                    }
                },
                () => {
                    resolve();
                },
            );
        });
    }

    /**
     * Submit request to the TikTok web API
     * Collect received metadata
     */
    private async submitScrapingRequest(query, item): Promise<any> {
        try {
            const result = await this.scrapeData(query, item);

            await this.collectPosts(result.body.itemListData);

            if (!result.body.hasMore) {
                throw new Error('No more posts');
            }
            this.maxCursor = parseInt(result.body.maxCursor, 10);
        } catch (error) {
            throw error.message;
        }
    }

    /**
     * Store collector data in the CSV and/or JSON files
     */
    private async saveCollectorData(): Promise<string[]> {
        if (this.download) {
            if (this.cli) {
                this.spinner.stop();
            }
            if (this.collector.length && !this.test) {
                await this.Downloader.downloadPosts({
                    zip: this.zip,
                    folder: this.folderDestination,
                    collector: this.collector,
                    fileName: this.fileDestination,
                    asyncDownload: this.asyncDownload,
                });
            }
        }
        let json = '';
        let csv = '';
        let zip = '';

        if (this.collector.length) {
            json = `${this.fileDestination}.json`;
            csv = `${this.fileDestination}.csv`;
            zip = this.zip ? `${this.fileDestination}.zip` : this.folderDestination;

            await this.saveMetadata({ json, csv });
        }
        if (this.cli) {
            this.spinner.stop();
        }
        return [json, csv, zip];
    }

    /**
     * Save post metadata
     * @param param0
     */
    public async saveMetadata({ json, csv }) {
        if (this.collector.length) {
            switch (this.filetype) {
                case 'json':
                    await fromCallback(cb => writeFile(json, JSON.stringify(this.collector), cb));
                    break;
                case 'csv':
                    await fromCallback(cb => writeFile(csv, this.json2csvParser.parse(this.collector), cb));
                    break;
                case 'all':
                    await Promise.all([
                        await fromCallback(cb => writeFile(json, JSON.stringify(this.collector), cb)),
                        await fromCallback(cb => writeFile(csv, this.json2csvParser.parse(this.collector), cb)),
                    ]);
                    break;
                default:
                    break;
            }
        }
    }

    /**
     * Store progress to avoid downloading duplicates
     * Only available from the CLI
     */
    private async storeDownlodProgress() {
        const historyType = this.scrapeType === 'trend' ? 'trend' : `${this.scrapeType}_${this.input}`;
        if (this.storeValue) {
            let history = {} as History;

            try {
                const readFromStore = (await fromCallback(cb =>
                    readFile(`${this.historyPath}/tiktok_history.json`, { encoding: 'utf-8' }, cb),
                )) as string;
                history = JSON.parse(readFromStore);
            } catch (error) {
                history[historyType] = {
                    type: this.scrapeType,
                    input: this.input,
                    downloaded_posts: 0,
                    last_change: new Date(),
                    file_location: `${this.historyPath}/${this.storeValue}.json`,
                };
            }

            if (!history[historyType]) {
                history[historyType] = {
                    type: this.scrapeType,
                    input: this.input,
                    downloaded_posts: 0,
                    last_change: new Date(),
                    file_location: `${this.historyPath}/${this.storeValue}.json`,
                };
            }
            let store: string[];
            try {
                const readFromStore = (await fromCallback(cb =>
                    readFile(`${this.historyPath}/${this.storeValue}.json`, { encoding: 'utf-8' }, cb),
                )) as string;
                store = JSON.parse(readFromStore);
            } catch (error) {
                store = [];
            }

            this.collector = this.collector.map(item => {
                if (store.indexOf(item.id) === -1) {
                    store.push(item.id);
                } else {
                    // eslint-disable-next-line no-param-reassign
                    item.repeated = true;
                }
                return item;
            });
            this.collector = this.collector.filter(item => !item.repeated);

            history[historyType] = {
                type: this.scrapeType,
                input: this.input,
                downloaded_posts: history[historyType].downloaded_posts + this.collector.length,
                last_change: new Date(),
                file_location: `${this.historyPath}/${this.storeValue}.json`,
            };

            try {
                await fromCallback(cb => writeFile(`${this.historyPath}/${this.storeValue}.json`, JSON.stringify(store), cb));
            } catch (error) {
                // continue regardless of error
            }

            try {
                await fromCallback(cb => writeFile(`${this.historyPath}/tiktok_history.json`, JSON.stringify(history), cb));
            } catch (error) {
                // continue regardless of error
            }
        }
    }

    private collectPosts(posts: Item[]) {
        for (let i = 0; i < posts.length; i += 1) {
            if (this.number) {
                if (this.collector.length >= this.number) {
                    break;
                }
            }

            if (this.noDuplicates.indexOf(posts[i].itemInfos.id) === -1) {
                this.noDuplicates.push(posts[i].itemInfos.id);
                const item: PostCollector = {
                    id: posts[i].itemInfos.id,
                    text: posts[i].itemInfos.text,
                    createTime: posts[i].itemInfos.createTime,
                    authorMeta: {
                        id: posts[i].authorInfos.userId,
                        secUid: posts[i].authorInfos.secUid,
                        name: posts[i].authorInfos.uniqueId,
                        nickName: posts[i].authorInfos.nickName,
                        following: posts[i].authorStats.followingCount,
                        fans: posts[i].authorStats.followerCount,
                        heart: posts[i].authorStats.heartCount,
                        video: posts[i].authorStats.videoCount,
                        digg: posts[i].authorStats.diggCount,
                        verified: posts[i].authorInfos.verified,
                        private: posts[i].authorInfos.isSecret,
                        signature: posts[i].authorInfos.signature,
                        avatar: posts[i].authorInfos.coversMedium[0],
                    },
                    musicMeta: {
                        musicId: posts[i].itemInfos.musicId,
                        musicName: posts[i].musicInfos.musicName,
                        musicAuthor: posts[i].musicInfos.authorName,
                        musicOriginal: posts[i].musicInfos.original,
                        playUrl: posts[i].musicInfos.playUrl[0],
                    },
                    covers: {
                        default: posts[i].itemInfos.covers[0],
                        origin: posts[i].itemInfos.coversOrigin[0],
                        dynamic: posts[i].itemInfos.coversDynamic[0],
                    },
                    imageUrl: posts[i].itemInfos.coversOrigin[0],
                    webVideoUrl: `https://www.tiktok.com/@${posts[i].authorInfos.uniqueId}/video/${posts[i].itemInfos.id}`,
                    videoUrl: posts[i].itemInfos.video.urls[0],
                    videoUrlNoWaterMark: '',
                    videoMeta: posts[i].itemInfos.video.videoMeta,
                    diggCount: posts[i].itemInfos.diggCount,
                    shareCount: posts[i].itemInfos.shareCount,
                    playCount: posts[i].itemInfos.playCount,
                    commentCount: posts[i].itemInfos.commentCount,
                    downloaded: false,
                    mentions: posts[i].itemInfos.text.match(/(@\w+)/g) || [],
                    hashtags: posts[i].challengeInfoList.map(({ challengeId, challengeName, text, coversLarger }) => ({
                        id: challengeId,
                        name: challengeName,
                        title: text,
                        cover: coversLarger,
                    })),
                };

                if (this.event) {
                    this.emit('data', item);
                    this.collector.push({} as PostCollector);
                } else {
                    this.collector.push(item);
                }
            }
        }
    }

    private async scrapeData(qs: RequestQuery, maxCursor: number): Promise<ItemListData> {
        const shareUid = qs.type === 4 || qs.type === 5 ? '&shareUid=' : '';
        const signature = this.signature
            ? this.signature
            : generateSignature(
                  `${this.mainHost}share/item/list?secUid=${qs.secUid}&id=${qs.id}&type=${qs.type}&count=${qs.count}&minCursor=${
                      qs.minCursor
                  }&maxCursor=${maxCursor || 0}${shareUid}&lang=${qs.lang}&shareUid=${qs.shareUid}&verifyFp=${qs.verifyFp}`,
                  this.userAgent,
                  this.tacValue,
              );
        this.signature = '';
        this.storeValue = this.scrapeType === 'trend' ? 'trend' : qs.id;

        const options = {
            uri: `${this.mainHost}share/item/list`,
            method: 'GET',
            qs: {
                ...qs,
                _signature: signature,
                maxCursor: maxCursor || 0,
            },
            headers: {
                accept: 'application/json, text/plain, */*',
                referer: 'https://www.tiktok.com/',
            },
            json: true,
        };
        try {
            const response = await this.request<ItemListData>(options);

            if (response.statusCode === 0) {
                return response;
            }
            throw new Error('Not more posts');
        } catch (error) {
            throw error.message;
        }
    }

    /**
     * Get trending feed query
     */
    // eslint-disable-next-line class-methods-use-this
    private async getTrendingFeedQuery(): Promise<RequestQuery> {
        return {
            id: '',
            secUid: '',
            shareUid: '',
            lang: '',
            type: 5,
            count: 30,
            minCursor: 0,
            verifyFp: '',
        };
    }

    /**
     * Get music feed query
     */
    private async getMusicFeedQuery(): Promise<RequestQuery> {
        return {
            id: this.input,
            secUid: '',
            shareUid: '',
            lang: '',
            type: 4,
            count: 30,
            minCursor: 0,
            verifyFp: '',
        };
    }

    /**
     * Get hashtag ID
     */
    private async getHashTagId(): Promise<RequestQuery> {
        if (this.idStore) {
            return {
                id: this.idStore,
                secUid: '',
                type: 3,
                count: 30,
                minCursor: 0,
                lang: '',
                verifyFp: '',
                shareUid: '',
            };
        }
        const query = {
            uri: `${this.mainHost}node/share/tag/${encodeURIComponent(this.input)}`,
            method: 'GET',
            json: true,
        };
        try {
            const response = await this.request<ApiResponse<'challengeData', Challenge>>(query);
            if (response.statusCode !== 0 || !response.body.challengeData) {
                throw new Error(`Can not find the hashtag: ${this.input}`);
            }
            this.idStore = response.body.challengeData.challengeId;
            return {
                id: response.body.challengeData.challengeId,
                secUid: '',
                type: 3,
                count: 30,
                minCursor: 0,
                lang: '',
                verifyFp: '',
                shareUid: '',
            };
        } catch (error) {
            throw error.message;
        }
    }

    /**
     * Get user ID
     */
    private async getUserId(): Promise<RequestQuery> {
        if (this.byUserId || this.idStore) {
            return {
                id: this.idStore ? this.idStore : this.input,
                secUid: '',
                type: 1,
                count: 30,
                minCursor: 0,
                lang: '',
                verifyFp: '',
                shareUid: '',
            };
        }

        const query = {
            uri: `${this.mainHost}node/share/user/@${encodeURIComponent(this.input)}`,
            method: 'GET',
            json: true,
        };
        try {
            const response = await this.request<ApiResponse<'userData', UserData>>(query);
            if (response.statusCode !== 0 || !response.body.userData) {
                throw new Error(`Can not find the user: ${this.input}`);
            }
            this.idStore = response.body.userData.userId;

            return {
                id: response.body.userData.userId,
                secUid: '',
                type: 1,
                count: 30,
                minCursor: 0,
                lang: '',
                verifyFp: '',
                shareUid: '',
            };
        } catch (error) {
            throw error.message;
        }
    }

    /**
     * Get user profile information
     * @param {} username
     */
    public async getUserProfileInfo(): Promise<UserData> {
        if (!this.input) {
            throw `Username is missing`;
        }
        const query = {
            uri: `${this.mainHost}node/share/user/@${this.input}`,
            method: 'GET',
            json: true,
        };
        try {
            const response = await this.request<ApiResponse<'userData', UserData>>(query);
            if (response.statusCode !== 0 || !response.body.userData) {
                throw new Error(`Can't find user: ${this.input}`);
            }
            return response.body.userData;
        } catch (error) {
            throw error.message;
        }
    }

    /**
     * Get hashtag information
     * @param {} hashtag
     */
    public async getHashtagInfo(): Promise<Challenge> {
        if (!this.input) {
            throw `Hashtag is missing`;
        }
        const query = {
            uri: `${this.mainHost}node/share/tag/${this.input}`,
            method: 'GET',
            json: true,
        };

        try {
            const response = await this.request<ApiResponse<'challengeData', Challenge>>(query);
            if (response.statusCode !== 0 || !response.body.challengeData) {
                throw new Error(`Can't find hashtag: ${this.input}`);
            }
            return response.body.challengeData;
        } catch (error) {
            throw error.message;
        }
    }

    /**
     * Sign URL
     * @param {}
     */
    public async signUrl() {
        if (!this.input) {
            throw `Url is missing`;
        }
        if (!this.tacValue) {
            await this.extractTac();
        }

        return generateSignature(this.input, this.userAgent, this.tacValue);
    }

    /**
     * Get video url without the watermark
     * @param {}
     */
    public async getVideoMeta(): Promise<PostCollector> {
        if (!this.input) {
            throw `Url is missing`;
        }
        if (!/^https:\/\/(www|v[a-z]{1})+\.tiktok\.com\/(\w.+|@(.\w.+)\/video\/(\d+))$/.test(this.input)) {
            throw `Not supported url format`;
        }
        const query = {
            uri: this.input,
            method: 'GET',
            json: true,
        };
        try {
            const response = await this.request<string>(query);
            if (!response) {
                throw new Error(`Can't extract video meta data`);
            }
            const regex = /<script id="__NEXT_DATA__" type="application\/json" crossorigin="anonymous">([^]*)<\/script><script crossorigin="anonymous" nomodule=/.exec(
                response,
            );
            if (regex) {
                const videoProps = JSON.parse(regex[1]);
                let videoItem = {} as PostCollector;
                if (videoProps.props.pageProps.statusCode) {
                    throw new Error();
                }
                videoItem = {
                    id: videoProps.props.pageProps.videoData.itemInfos.id,
                    text: videoProps.props.pageProps.videoData.itemInfos.text,
                    createTime: videoProps.props.pageProps.videoData.itemInfos.createTime,
                    authorMeta: {
                        id: videoProps.props.pageProps.videoData.itemInfos.authorId,
                        name: videoProps.props.pageProps.videoData.authorInfos.uniqueId,
                    },
                    musicMeta: {
                        musicId: videoProps.props.pageProps.videoData.musicInfos.musicId,
                        musicName: videoProps.props.pageProps.videoData.musicInfos.musicName,
                        musicAuthor: videoProps.props.pageProps.videoData.musicInfos.authorName,
                    },
                    imageUrl: videoProps.props.pageProps.videoData.itemInfos.coversOrigin[0],
                    videoUrl: videoProps.props.pageProps.videoData.itemInfos.video.urls[0],
                    videoUrlNoWaterMark: '',
                    videoMeta: videoProps.props.pageProps.videoData.itemInfos.video.videoMeta,
                    covers: {
                        default: videoProps.props.pageProps.videoData.itemInfos.covers[0],
                        origin: videoProps.props.pageProps.videoData.itemInfos.coversOrigin[0],
                    },
                    diggCount: videoProps.props.pageProps.videoData.itemInfos.diggCount,
                    shareCount: videoProps.props.pageProps.videoData.itemInfos.shareCount,
                    playCount: videoProps.props.pageProps.videoData.itemInfos.playCount,
                    commentCount: videoProps.props.pageProps.videoData.itemInfos.commentCount,
                    downloaded: false,
                    mentions: videoProps.props.pageProps.videoData.itemInfos.text.match(/(@\w+)/g) || [],
                    hashtags: videoProps.props.pageProps.videoData.challengeInfoList.map(({ challengeId, challengeName, text, coversLarger }) => ({
                        id: challengeId,
                        name: challengeName,
                        title: text,
                        cover: coversLarger,
                    })),
                } as PostCollector;

                try {
                    const video = await this.extractVideoId(videoItem.videoUrl);
                    videoItem.videoUrlNoWaterMark = video;
                } catch (error) {
                    // continue regardless of error
                }
                this.collector.push(videoItem);

                return videoItem;
            }
            throw new Error();
        } catch (error) {
            throw `Can't extract metadata from the video: ${this.input}`;
        }
    }
}
