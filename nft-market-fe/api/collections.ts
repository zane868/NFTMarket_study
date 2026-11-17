import { request } from './request';


type GetCollectionsParams = {
    limit: number;
    range: '15m' | '1h' | '6h' | '1d' | '7d' | '30d';
};
function GetCollections(params: GetCollectionsParams) {
    return request.get('/collections/ranking', {
        params,
    });
};

type GetCollectionDetailParams = {
    address: string;
    chain_id: string | number;
};
function GetCollectionDetail(params: GetCollectionDetailParams) {
    return request.get(`/collections/${params.address}`, {
        params,
    });
};

// {"sort":1,"status":[1, 2],"markets":[],"token_id":"21","user_address":"0x3D7155586d33a31851e28bd4Ead18A413Bc8F599","chain_id":11155111,"page":1,"page_size":20}
type GetCollectionItemsParams = {
    address: string;
    filters: {
        sort: number;
        status: number[];
        markets: string[];
        token_id?: string;
        user_address: string;
        chain_id: string | number;
        page: number;
        page_size: number;
    }
};
function GetCollectionItems(params: GetCollectionItemsParams) {
    // /collections/{address}/items
    return request.get(`/collections/${params.address}/items`, {
        params: {
            filters: JSON.stringify(params.filters),
            // chain_id: params.filter.chain_id,
        },
    });
};

function getCollectionItemDetail(address: string, token_id: string, chain_id: string | number) {
    return request.get(`/collections/${address}/${token_id}`, {
        params: {
            chain_id: chain_id,
        },
    });
};

// /collections/{address}/bids —— 合集买单（按价格档聚合）
type GetCollectionBidsParams = {
    address: string;
    chain_id: string | number;
    page?: number;
    page_size?: number;
};
function GetCollectionBids(params: GetCollectionBidsParams) {
    return request.get(`/collections/${params.address}/bids`, {
        params: {
            filters: JSON.stringify({
                chain_id: params.chain_id,
                page: params.page ?? 1,
                page_size: params.page_size ?? 10,
            }),
        },
    });
};

// eslint-disable-next-line import/no-anonymous-default-export
export default {
    GetCollections,
    GetCollectionDetail,
    GetCollectionItems,
    getCollectionItemDetail,
    GetCollectionBids,
};