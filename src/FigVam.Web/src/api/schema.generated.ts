// Generated from the FigVam ASP.NET OpenAPI contract. Do not edit.
export interface paths {
    "/api/auth/config": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/identity": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DocumentActor"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/users": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["InviteUserRequest"];
                    "application/json": components["schemas"]["InviteUserRequest"];
                    "text/json": components["schemas"]["InviteUserRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/users/{id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    id: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["UpdateUserRequest"];
                    "application/json": components["schemas"]["UpdateUserRequest"];
                    "text/json": components["schemas"]["UpdateUserRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/users/lookup": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List accessible documents
         * @description Reads catalog metadata independently of document contents. Incompatible documents remain visible with their stored profile and compatibility issue. Legacy timestamps may be unknown; unreadable metadata is reported when membership can be verified. Only owners can delete documents using the revision-checked delete command.
         */
        get: {
            parameters: {
                query?: {
                    cursor?: string;
                    limit?: number | string;
                };
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DocumentListResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        /** Create an empty document owned by the authenticated actor */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["CreateDocumentRequest"];
                    "application/json": components["schemas"]["CreateDocumentRequest"];
                    "text/json": components["schemas"]["CreateDocumentRequest"];
                };
            };
            responses: {
                /** @description Created */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DocumentAccessResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read a document at the requested or current revision */
        get: {
            parameters: {
                query?: {
                    Depth?: number | string;
                    Fields?: string;
                    Kind?: string;
                    Limit?: number | string;
                    NamePrefix?: string;
                    Offset?: number | string;
                    /** @description Committed document revision to read; omitted selects the current revision. */
                    Revision?: number | string;
                    ScreenId?: string;
                    SemanticKey?: string;
                };
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["StructureResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/assets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read a bounded asset manifest at a revision or saved version
         * @description Omit selectors for current draft; supply revision or versionId, never both. Returns at most 256 immutable manifest entries, without content. Current document read permission is required, including for saved versions.
         */
        get: {
            parameters: {
                query?: {
                    revision?: number | string;
                    versionId?: string;
                };
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DocumentAssetsResponse"];
                        "text/json": components["schemas"]["DocumentAssetsResponse"];
                        "text/plain": components["schemas"]["DocumentAssetsResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "text/json": components["schemas"]["ApiError"];
                        "text/plain": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "text/json": components["schemas"]["ApiError"];
                        "text/plain": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "text/json": components["schemas"]["ApiError"];
                        "text/plain": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "text/json": components["schemas"]["ApiError"];
                        "text/plain": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "text/json": components["schemas"]["ApiError"];
                        "text/plain": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "text/json": components["schemas"]["ApiError"];
                        "text/plain": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "text/json": components["schemas"]["ApiError"];
                        "text/plain": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "text/json": components["schemas"]["ApiError"];
                        "text/plain": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "text/json": components["schemas"]["ApiError"];
                        "text/plain": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/assets/{assetId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read verified image or font bytes from a document snapshot
         * @description Requires current document read permission and asset membership in the selected draft revision or saved version. revision and versionId are mutually exclusive. Returns the asset MIME type with no-store, nosniff, sandbox CSP and SHA-256 ETag; no public storage URLs or redirects. At most 5 MiB.
         */
        get: {
            parameters: {
                query?: {
                    revision?: number | string;
                    versionId?: string;
                };
                header?: never;
                path: {
                    assetId: string;
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "font/otf": string;
                        "font/ttf": string;
                        "font/woff": string;
                        "font/woff2": string;
                        "image/png": string;
                        "image/svg+xml": string;
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "font/otf": components["schemas"]["ApiError"];
                        "font/ttf": components["schemas"]["ApiError"];
                        "font/woff": components["schemas"]["ApiError"];
                        "font/woff2": components["schemas"]["ApiError"];
                        "image/png": components["schemas"]["ApiError"];
                        "image/svg+xml": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "font/otf": components["schemas"]["ApiError"];
                        "font/ttf": components["schemas"]["ApiError"];
                        "font/woff": components["schemas"]["ApiError"];
                        "font/woff2": components["schemas"]["ApiError"];
                        "image/png": components["schemas"]["ApiError"];
                        "image/svg+xml": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "font/otf": components["schemas"]["ApiError"];
                        "font/ttf": components["schemas"]["ApiError"];
                        "font/woff": components["schemas"]["ApiError"];
                        "font/woff2": components["schemas"]["ApiError"];
                        "image/png": components["schemas"]["ApiError"];
                        "image/svg+xml": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "font/otf": components["schemas"]["ApiError"];
                        "font/ttf": components["schemas"]["ApiError"];
                        "font/woff": components["schemas"]["ApiError"];
                        "font/woff2": components["schemas"]["ApiError"];
                        "image/png": components["schemas"]["ApiError"];
                        "image/svg+xml": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "font/otf": components["schemas"]["ApiError"];
                        "font/ttf": components["schemas"]["ApiError"];
                        "font/woff": components["schemas"]["ApiError"];
                        "font/woff2": components["schemas"]["ApiError"];
                        "image/png": components["schemas"]["ApiError"];
                        "image/svg+xml": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "font/otf": components["schemas"]["ApiError"];
                        "font/ttf": components["schemas"]["ApiError"];
                        "font/woff": components["schemas"]["ApiError"];
                        "font/woff2": components["schemas"]["ApiError"];
                        "image/png": components["schemas"]["ApiError"];
                        "image/svg+xml": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "font/otf": components["schemas"]["ApiError"];
                        "font/ttf": components["schemas"]["ApiError"];
                        "font/woff": components["schemas"]["ApiError"];
                        "font/woff2": components["schemas"]["ApiError"];
                        "image/png": components["schemas"]["ApiError"];
                        "image/svg+xml": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "font/otf": components["schemas"]["ApiError"];
                        "font/ttf": components["schemas"]["ApiError"];
                        "font/woff": components["schemas"]["ApiError"];
                        "font/woff2": components["schemas"]["ApiError"];
                        "image/png": components["schemas"]["ApiError"];
                        "image/svg+xml": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "font/otf": components["schemas"]["ApiError"];
                        "font/ttf": components["schemas"]["ApiError"];
                        "font/woff": components["schemas"]["ApiError"];
                        "font/woff2": components["schemas"]["ApiError"];
                        "image/png": components["schemas"]["ApiError"];
                        "image/svg+xml": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        /**
         * Upload a safe image asset through the document command stream
         * @description Raw image/png or image/svg+xml body, at most 5 MiB; commandId and assetId must be nonempty UUIDs. PNG must be static and pass the bounded raster decoder. SVG must contain only allowed static vector elements and local fragment references; scripts, stylesheets, external resources and DTDs are rejected. Maximum dimension 4096, 4194304 pixels, 256 assets and 64 MiB per document. Editor or Owner required. Content, SHA-256, manifest, revision and event commit atomically. commandId retries return the original result; undo removes an asset only if references remain valid. Retained blobs are never collected in this version.
         */
        put: {
            parameters: {
                query?: {
                    commandId?: string;
                };
                header?: never;
                path: {
                    assetId: string;
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "image/png": string;
                    "image/svg+xml": string;
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                        "text/json": components["schemas"]["CommandResponse"];
                        "text/plain": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "text/json": components["schemas"]["ApiError"];
                        "text/plain": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "text/json": components["schemas"]["ApiError"];
                        "text/plain": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "text/json": components["schemas"]["ApiError"];
                        "text/plain": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "text/json": components["schemas"]["ApiError"];
                        "text/plain": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "text/json": components["schemas"]["ApiError"];
                        "text/plain": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "text/json": components["schemas"]["ApiError"];
                        "text/plain": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "text/json": components["schemas"]["ApiError"];
                        "text/plain": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "text/json": components["schemas"]["ApiError"];
                        "text/plain": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "text/json": components["schemas"]["ApiError"];
                        "text/plain": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/children/{parentId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List ordered children of a screen or node */
        get: {
            parameters: {
                query?: {
                    Depth?: number | string;
                    Fields?: string;
                    Kind?: string;
                    Limit?: number | string;
                    NamePrefix?: string;
                    Offset?: number | string;
                    /** @description Committed document revision to read; omitted selects the current revision. */
                    Revision?: number | string;
                    ScreenId?: string;
                    SemanticKey?: string;
                };
                header?: never;
                path: {
                    documentId: string;
                    parentId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["StructureResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/add-component-definition": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create a component definition from an existing document subtree */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["AddComponentDefinitionRequest"];
                    "application/json": components["schemas"]["AddComponentDefinitionRequest"];
                    "text/json": components["schemas"]["AddComponentDefinitionRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/add-component-parameter": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Add a typed component parameter and bind it to a definition node property */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["AddComponentParameterRequest"];
                    "application/json": components["schemas"]["AddComponentParameterRequest"];
                    "text/json": components["schemas"]["AddComponentParameterRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/add-component-slot": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Expose a container in the component definition as a slot */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["AddComponentSlotRequest"];
                    "application/json": components["schemas"]["AddComponentSlotRequest"];
                    "text/json": components["schemas"]["AddComponentSlotRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/add-component-variant": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Add parameter differences from a base variant in the same component; built-in kinds are unique */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["AddComponentVariantRequest"];
                    "application/json": components["schemas"]["AddComponentVariantRequest"];
                    "text/json": components["schemas"]["AddComponentVariantRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/add-csv-dataset": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create a local dataset from a CSV snapshot
         * @description CSV has unique nonblank headers, comma delimiters and LF or CRLF records. Quotes enclose fields and doubled quotes escape a quote. Every row has the header column count; values become JSON strings. CSV and resulting JSON are each limited to 65536 UTF-8 bytes. See README for the complete format.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["AddCsvDatasetRequest"];
                    "application/json": components["schemas"]["AddCsvDatasetRequest"];
                    "text/json": components["schemas"]["AddCsvDatasetRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/add-dataset": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create a local dataset and its saved JSON fixture
         * @description Name is nonblank, at most 256 characters without control characters. FixtureJson is a JSON string containing one valid JSON value, at most 65536 UTF-8 bytes and depth 32, with unique object keys. At most 1000 datasets and 8 MiB of fixtures per document. Request body limit is 512 KiB. Duplicate names are allowed; IDs are unique. Fixture contents are persisted with the document.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["AddDatasetRequest"];
                    "application/json": components["schemas"]["AddDatasetRequest"];
                    "text/json": components["schemas"]["AddDatasetRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/add-node": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Atomically add a node with its initial typed properties
         * @description Add a node to a screen or container. The properties map accepts names and typed values from the document profile. Image requires an asset property referencing an existing document asset.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["AddNodeRequest"];
                    "application/json": components["schemas"]["AddNodeRequest"];
                    "text/json": components["schemas"]["AddNodeRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/add-page": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Add a page */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["AddPageRequest"];
                    "application/json": components["schemas"]["AddPageRequest"];
                    "text/json": components["schemas"]["AddPageRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/add-screen": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Add a screen to a page
         * @description dimensions requires width and height in logical uiUnits. Both must be finite and non-negative; zero is valid.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["AddScreenRequest"];
                    "application/json": components["schemas"]["AddScreenRequest"];
                    "text/json": components["schemas"]["AddScreenRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/add-screen-variant": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Create an empty screen variant inheriting base node properties */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["AddScreenVariantRequest"];
                    "application/json": components["schemas"]["AddScreenVariantRequest"];
                    "text/json": components["schemas"]["AddScreenVariantRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/add-token": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Add a typed design token with Light and Dark values */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["AddTokenRequest"];
                    "application/json": components["schemas"]["AddTokenRequest"];
                    "text/json": components["schemas"]["AddTokenRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/bind-node-data": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Bind a scalar node property to a saved local dataset fixture
         * @description Requires an existing dataset and node, a path of at most 32 typed property/index segments, and a string, number or boolean target supported by the current profile. Value requires an explicit matching expectedType. Count returns a number; isEmpty, isPresent and isNull return booleans. The current fixture must evaluate successfully and satisfy profile value constraints. Binding preserves the stored literal; unbinding exposes it again. Fixture replacements may produce data diagnostics without changing the binding. No scripts or remote sources are supported.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["BindNodeDataRequest"];
                    "application/json": components["schemas"]["BindNodeDataRequest"];
                    "text/json": components["schemas"]["BindNodeDataRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/create-scenario": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Create a saved prototype event and ordered actions
         * @description Scenario requires a globally unique ID, screenId, nodeId, numeric event (Click=0, Change=1, Hover=2, Leave=3, Submit=4), and 1-32 typed actions. Profile must explicitly support the event, actions and demo value targets.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["CreateScenarioRequest"];
                    "application/json": components["schemas"]["CreateScenarioRequest"];
                    "text/json": components["schemas"]["CreateScenarioRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/delete-component-definition": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Delete a component definition at the expected revision; used definitions require explicit compatible replacement mappings or prior detachment of all instances */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["DeleteComponentDefinitionRequest"];
                    "application/json": components["schemas"]["DeleteComponentDefinitionRequest"];
                    "text/json": components["schemas"]["DeleteComponentDefinitionRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/delete-dataset": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Delete an unreferenced local dataset at the expected revision */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["DeleteDatasetRequest"];
                    "application/json": components["schemas"]["DeleteDatasetRequest"];
                    "text/json": components["schemas"]["DeleteDatasetRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/delete-document": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Delete a document at the expected revision (Owner only)
         * @description Requires commandId and nonnegative expectedRevision matching the current draft. Atomically commits a durable tombstone, journal event and next revision before ACK; retains snapshots, assets and saved versions without physical cleanup. The document becomes inaccessible to reads (including historical revisions and versions), writes, exports, presence and subscriptions. Existing subscriptions terminate without further document events. Owners retain only deletion retry authorization: the original commandId returns its original result even after restart; a new deletion command returns DOCUMENT_NOT_FOUND (404). Editor/Viewer/outsider receive FORBIDDEN (403), stale revision REVISION_CONFLICT (409), invalid IDs/revision INVALID_ID/INVALID_REVISION (400). Refusal changes neither model nor revision. Deletion cannot be undone or restored through normal document operations.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["DeleteDocumentRequest"];
                    "application/json": components["schemas"]["DeleteDocumentRequest"];
                    "text/json": components["schemas"]["DeleteDocumentRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/delete-node": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Delete a node */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["DeleteNodeRequest"];
                    "application/json": components["schemas"]["DeleteNodeRequest"];
                    "text/json": components["schemas"]["DeleteNodeRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/delete-page": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Delete a page and its screens and node subtrees at an expected revision
         * @description Requires edit permission and expectedRevision matching the current draft. Deletes contained component instances and screen variants. Retained references from pages, scenarios or component definitions cause PAGE_IN_USE (409); remove those references explicitly first. Missing page returns PAGE_NOT_FOUND (404), stale revision REVISION_CONFLICT (409). Refusal preserves the document and revision. Reusing commandId returns its original result. Undo/Redo use the shared safe compensation history.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["DeletePageRequest"];
                    "application/json": components["schemas"]["DeletePageRequest"];
                    "text/json": components["schemas"]["DeletePageRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/delete-scenario": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Delete one saved scenario with an exact revision precondition */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["DeleteScenarioRequest"];
                    "application/json": components["schemas"]["DeleteScenarioRequest"];
                    "text/json": components["schemas"]["DeleteScenarioRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/delete-screen": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Delete a screen and its node subtrees at an expected revision
         * @description Requires edit permission and expectedRevision matching the current draft. Deletes contained nodes, component instances and screen variants. Retained references cause SCREEN_IN_USE (409); remove those references explicitly first. Missing screen returns SCREEN_NOT_FOUND (404), stale revision REVISION_CONFLICT (409). Refusal preserves the document and revision. Reusing commandId returns its original result. Undo/Redo use the shared safe compensation history.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["DeleteScreenRequest"];
                    "application/json": components["schemas"]["DeleteScreenRequest"];
                    "text/json": components["schemas"]["DeleteScreenRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/delete-style": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Delete a design style only when no references depend on it */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["DeleteStyleRequest"];
                    "application/json": components["schemas"]["DeleteStyleRequest"];
                    "text/json": components["schemas"]["DeleteStyleRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/delete-token": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Delete an unused token with revision and dependency checks */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["DeleteTokenRequest"];
                    "application/json": components["schemas"]["DeleteTokenRequest"];
                    "text/json": components["schemas"]["DeleteTokenRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/detach-component-instance": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Materialize a component instance at the expected revision and remove its definition link */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["DetachComponentInstanceRequest"];
                    "application/json": components["schemas"]["DetachComponentInstanceRequest"];
                    "text/json": components["schemas"]["DetachComponentInstanceRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/duplicate-screen": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Atomically duplicate a screen, its nodes and variants with new unique IDs */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["DuplicateScreenRequest"];
                    "application/json": components["schemas"]["DuplicateScreenRequest"];
                    "text/json": components["schemas"]["DuplicateScreenRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/import-design-tokens": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Atomically import nested DTCG 2025.10 tokens with Light/Dark, typed metadata and explicit category mappings */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["ImportDesignTokensRequest"];
                    "application/json": components["schemas"]["ImportDesignTokensRequest"];
                    "text/json": components["schemas"]["ImportDesignTokensRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/insert-component-instance": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Insert a component instance at a parent child position */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["InsertComponentInstanceRequest"];
                    "application/json": components["schemas"]["InsertComponentInstanceRequest"];
                    "text/json": components["schemas"]["InsertComponentInstanceRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/move-node": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Move or reorder a node */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["MoveNodeRequest"];
                    "application/json": components["schemas"]["MoveNodeRequest"];
                    "text/json": components["schemas"]["MoveNodeRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/redo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Redo the actor's last applicable undone command */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["HistoryCommandRequest"];
                    "application/json": components["schemas"]["HistoryCommandRequest"];
                    "text/json": components["schemas"]["HistoryCommandRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/remove-component-parameter-override": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Remove a component instance parameter override to inherit its variant or default */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["RemoveComponentParameterOverrideRequest"];
                    "application/json": components["schemas"]["RemoveComponentParameterOverrideRequest"];
                    "text/json": components["schemas"]["RemoveComponentParameterOverrideRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/remove-component-variant-parameter-change": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Remove one variant parameter difference to inherit its base variant or parameter default */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["RemoveComponentVariantParameterChangeRequest"];
                    "application/json": components["schemas"]["RemoveComponentVariantParameterChangeRequest"];
                    "text/json": components["schemas"]["RemoveComponentVariantParameterChangeRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/remove-dataset-connector": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Remove a dataset connector link while preserving its offline fixture */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["RemoveDatasetConnectorRequest"];
                    "application/json": components["schemas"]["RemoveDatasetConnectorRequest"];
                    "text/json": components["schemas"]["RemoveDatasetConnectorRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/remove-node-properties": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Remove explicit node properties and restore inherited style values */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["RemoveNodePropertiesRequest"];
                    "application/json": components["schemas"]["RemoveNodePropertiesRequest"];
                    "text/json": components["schemas"]["RemoveNodePropertiesRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/remove-screen-variant-override": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Remove one screen property difference to inherit the base value */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["RemoveScreenVariantOverrideRequest"];
                    "application/json": components["schemas"]["RemoveScreenVariantOverrideRequest"];
                    "text/json": components["schemas"]["RemoveScreenVariantOverrideRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/rename-document": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Rename a document without changing its technical ID
         * @description Names must be nonblank, at most 256 characters and contain no control characters.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["RenameDocumentRequest"];
                    "application/json": components["schemas"]["RenameDocumentRequest"];
                    "text/json": components["schemas"]["RenameDocumentRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/rename-page": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Rename a page without changing its technical ID
         * @description Names must be nonblank, at most 256 characters and contain no control characters. Duplicate names are allowed.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["RenamePageRequest"];
                    "application/json": components["schemas"]["RenamePageRequest"];
                    "text/json": components["schemas"]["RenamePageRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/rename-screen": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Rename a screen without changing its technical ID
         * @description Names must be nonblank, at most 256 characters and contain no control characters. Duplicate names are allowed.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["RenameScreenRequest"];
                    "application/json": components["schemas"]["RenameScreenRequest"];
                    "text/json": components["schemas"]["RenameScreenRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/rename-token": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Rename a token without changing its technical ID */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["RenameTokenRequest"];
                    "application/json": components["schemas"]["RenameTokenRequest"];
                    "text/json": components["schemas"]["RenameTokenRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/replace-dataset-fixture": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Replace a dataset fixture with a revision precondition
         * @description Preserves dataset ID and name. ExpectedRevision must match the current document revision. Fixture and document limits are the same as add-dataset. Request body limit is 512 KiB. Retries of an accepted commandId return its original result.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["ReplaceDatasetFixtureRequest"];
                    "application/json": components["schemas"]["ReplaceDatasetFixtureRequest"];
                    "text/json": components["schemas"]["ReplaceDatasetFixtureRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/replace-dataset-fixture-from-csv": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Replace a dataset fixture from a CSV snapshot at the expected revision
         * @description Uses the CSV format and limits of add-csv-dataset and the revision precondition of replace-dataset-fixture.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["ReplaceDatasetFixtureFromCsvRequest"];
                    "application/json": components["schemas"]["ReplaceDatasetFixtureFromCsvRequest"];
                    "text/json": components["schemas"]["ReplaceDatasetFixtureFromCsvRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/resize-screen": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Set finite, non-negative screen dimensions in logical uiUnits
         * @description dimensions requires width and height in logical uiUnits. Both must be finite and non-negative; zero is valid. Optional updateWidth and updateHeight default to true; a false flag preserves that axis from the current server state. At least one axis must be updated. Children retain their properties.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["ResizeScreenRequest"];
                    "application/json": components["schemas"]["ResizeScreenRequest"];
                    "text/json": components["schemas"]["ResizeScreenRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/restore": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Restore a saved version as a new revision */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["RestoreDocumentRequest"];
                    "application/json": components["schemas"]["RestoreDocumentRequest"];
                    "text/json": components["schemas"]["RestoreDocumentRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/save": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Save an immutable document version */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["SaveDocumentRequest"];
                    "application/json": components["schemas"]["SaveDocumentRequest"];
                    "text/json": components["schemas"]["SaveDocumentRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/set-component-instance-variant": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Select a variant of the instance definition, or clear selection with null; explicit overrides take priority */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["SetComponentInstanceVariantRequest"];
                    "application/json": components["schemas"]["SetComponentInstanceVariantRequest"];
                    "text/json": components["schemas"]["SetComponentInstanceVariantRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/set-component-parameter-default": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Set the typed default value of a component parameter */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["SetComponentParameterDefaultRequest"];
                    "application/json": components["schemas"]["SetComponentParameterDefaultRequest"];
                    "text/json": components["schemas"]["SetComponentParameterDefaultRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/set-component-parameter-override": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Set a typed component instance parameter override */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["SetComponentParameterOverrideRequest"];
                    "application/json": components["schemas"]["SetComponentParameterOverrideRequest"];
                    "text/json": components["schemas"]["SetComponentParameterOverrideRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/set-component-slot-content": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Assign ordered direct children of an instance to its slot; an empty list clears assignment and preserves nodes */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["SetComponentSlotContentRequest"];
                    "application/json": components["schemas"]["SetComponentSlotContentRequest"];
                    "text/json": components["schemas"]["SetComponentSlotContentRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/set-component-variant-parameter-change": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Set one typed parameter difference on an existing component variant */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["SetComponentVariantParameterChangeRequest"];
                    "application/json": components["schemas"]["SetComponentVariantParameterChangeRequest"];
                    "text/json": components["schemas"]["SetComponentVariantParameterChangeRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/set-dataset-connector": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Assign an administrator-configured JSON connector ID without fetching data
         * @description Requires the current revision and an allowed server connector ID. Preserves the offline fixture. URLs, secrets and unknown request members are rejected.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["SetDatasetConnectorRequest"];
                    "application/json": components["schemas"]["SetDatasetConnectorRequest"];
                    "text/json": components["schemas"]["SetDatasetConnectorRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/set-node-name": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Set a node name without changing its technical ID */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["SetNodeNameRequest"];
                    "application/json": components["schemas"]["SetNodeNameRequest"];
                    "text/json": components["schemas"]["SetNodeNameRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/set-node-properties": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Atomically set one or more typed properties on one node
         * @description Supply a nonempty map of property names and typed values from the document profile. Pass expectedParentId for edits based on parent-relative coordinates and expectedRevision for edits based on a document revision.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["SetNodePropertiesRequest"];
                    "application/json": components["schemas"]["SetNodePropertiesRequest"];
                    "text/json": components["schemas"]["SetNodePropertiesRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/set-node-property": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Set a typed node property */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["SetNodePropertyRequest"];
                    "application/json": components["schemas"]["SetNodePropertyRequest"];
                    "text/json": components["schemas"]["SetNodePropertyRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/set-node-repeater": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Set a local dataset repeater at the expected revision, or clear it with null
         * @description Template and empty view are distinct direct children. Relative bindings target scalar properties in the concrete template. Nested repeaters are rejected. Expanded nodes and paths share a 10000 work budget, with at most 1000 items and 100 bindings.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["SetNodeRepeaterRequest"];
                    "application/json": components["schemas"]["SetNodeRepeaterRequest"];
                    "text/json": components["schemas"]["SetNodeRepeaterRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/set-node-semantic-key": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Set or clear a node semantic key */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["SetNodeSemanticKeyRequest"];
                    "application/json": components["schemas"]["SetNodeSemanticKeyRequest"];
                    "text/json": components["schemas"]["SetNodeSemanticKeyRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/set-screen-variant-override": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Set a typed property difference for a node belonging to the screen */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["SetScreenVariantOverrideRequest"];
                    "application/json": components["schemas"]["SetScreenVariantOverrideRequest"];
                    "text/json": components["schemas"]["SetScreenVariantOverrideRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/set-screen-variant-properties": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Atomically set multiple node property overrides for a variant at an expected revision */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["SetScreenVariantPropertiesRequest"];
                    "application/json": components["schemas"]["SetScreenVariantPropertiesRequest"];
                    "text/json": components["schemas"]["SetScreenVariantPropertiesRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/set-token-value": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Set a typed token value for a theme */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["SetTokenValueRequest"];
                    "application/json": components["schemas"]["SetTokenValueRequest"];
                    "text/json": components["schemas"]["SetTokenValueRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/unbind-node-data": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Remove a node property data binding while preserving its stored literal */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["UnbindNodeDataRequest"];
                    "application/json": components["schemas"]["UnbindNodeDataRequest"];
                    "text/json": components["schemas"]["UnbindNodeDataRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/undo": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Compensate the actor's last applicable command */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["HistoryCommandRequest"];
                    "application/json": components["schemas"]["HistoryCommandRequest"];
                    "text/json": components["schemas"]["HistoryCommandRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/update-scenario": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Replace one saved scenario with an exact revision precondition */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["UpdateScenarioRequest"];
                    "application/json": components["schemas"]["UpdateScenarioRequest"];
                    "text/json": components["schemas"]["UpdateScenarioRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/commands/upsert-style": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Atomically create or update an inheritable typed design style */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["UpsertStyleRequest"];
                    "application/json": components["schemas"]["UpsertStyleRequest"];
                    "text/json": components["schemas"]["UpsertStyleRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CommandResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/components": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Search component definitions at a document revision */
        get: {
            parameters: {
                query?: {
                    limit?: number | string;
                    offset?: number | string;
                    revision?: number | string;
                    search?: string;
                };
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ComponentListResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/components/{componentId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read a component definition at a document revision */
        get: {
            parameters: {
                query?: {
                    revision?: number | string;
                };
                header?: never;
                path: {
                    componentId: string;
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ComponentResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/components/{componentId}/usages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List component instances at a document revision */
        get: {
            parameters: {
                query?: {
                    limit?: number | string;
                    offset?: number | string;
                    revision?: number | string;
                };
                header?: never;
                path: {
                    componentId: string;
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ComponentUsagesResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/container.figvam": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Export a standalone .figvam container
         * @description Exports the latest revision, a specified revision or a saved versionId (mutually exclusive). Owner/Editor only. Missing asset dependencies cause an explicit error. Manifest schema: /api/v1/schemas/manifest-v1.json.
         */
        get: {
            parameters: {
                query?: {
                    revision?: number | string;
                    versionId?: string;
                };
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["FileContentResult"];
                        "text/json": components["schemas"]["FileContentResult"];
                        "text/plain": components["schemas"]["FileContentResult"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "text/json": components["schemas"]["ApiError"];
                        "text/plain": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "text/json": components["schemas"]["ApiError"];
                        "text/plain": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "text/json": components["schemas"]["ApiError"];
                        "text/plain": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "text/json": components["schemas"]["ApiError"];
                        "text/plain": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "text/json": components["schemas"]["ApiError"];
                        "text/plain": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "text/json": components["schemas"]["ApiError"];
                        "text/plain": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "text/json": components["schemas"]["ApiError"];
                        "text/plain": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/datasets": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List dataset metadata at a document revision
         * @description Returns metadata without fixture contents. Offset must be nonnegative; limit is 1–100 (default 50).
         */
        get: {
            parameters: {
                query?: {
                    limit?: number | string;
                    offset?: number | string;
                    revision?: number | string;
                };
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DatasetListResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/datasets/{datasetId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read dataset metadata at a document revision */
        get: {
            parameters: {
                query?: {
                    revision?: number | string;
                };
                header?: never;
                path: {
                    datasetId: string;
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DatasetResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/datasets/{datasetId}/fixture": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read saved offline JSON fixture at a document revision
         * @description Explicitly returns the saved local fixture as a JSON string (maximum 65536 UTF-8 bytes, depth 32). No remote data is fetched.
         */
        get: {
            parameters: {
                query?: {
                    revision?: number | string;
                };
                header?: never;
                path: {
                    datasetId: string;
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DatasetFixtureResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/diagnostics": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Validate the persisted document structure at a revision; optionally scope to a screen */
        get: {
            parameters: {
                query?: {
                    limit?: number | string;
                    offset?: number | string;
                    revision?: number | string;
                    screenId?: string;
                };
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["StructureDiagnosticsResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/document.json": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Export a standalone document.json
         * @description Exports format version 1, at the latest revision or a specified revision or saved versionId (mutually exclusive). Owner/Editor only. At most 16 MiB. Excludes remote live data and server secrets. Schema: /api/v1/schemas/document-v1.json. Missing asset dependencies and unsupported data cause explicit errors without partial output.
         */
        get: {
            parameters: {
                query?: {
                    revision?: number | string;
                    versionId?: string;
                };
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["JsonElement"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/events": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Subscribe to committed document changes
         * @description SSE frames: event is the code, data is DocumentSubscriptionMessage JSON. READY opens the requested cursor; CHANGE carries a committed event and its SSE id equals revision; HEARTBEAT does not advance the cursor. FORBIDDEN terminates on revoked read access. On RECONNECT_REQUIRED, EOF or a revision gap call GET reconnect with the last applied revision, apply its events/snapshot and subscribe from the resulting revision. Requires Authorization bearer header; only lastSeenRevision is accepted in query. Last-Event-ID is ignored. Ordered shared-journal polling every 100ms; limits: 5 streams per actor, 128 per process, 5s write deadline, 1h/token-expiry lifetime. No exactly-once network delivery guarantee.
         */
        get: {
            parameters: {
                query?: {
                    lastSeenRevision?: number | string;
                };
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "text/event-stream": components["schemas"]["DocumentSubscriptionMessage"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "text/json": components["schemas"]["ApiError"];
                        "text/plain": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "text/json": components["schemas"]["ApiError"];
                        "text/plain": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "text/json": components["schemas"]["ApiError"];
                        "text/plain": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "text/json": components["schemas"]["ApiError"];
                        "text/plain": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/mcp-access": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/mcp-access/tunnel": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content?: never;
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/members": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Assign a member role (Owner only) */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["SetDocumentMemberRequest"];
                    "application/json": components["schemas"]["SetDocumentMemberRequest"];
                    "text/json": components["schemas"]["SetDocumentMemberRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DocumentAccessResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/members/{memberId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        post?: never;
        /** Remove a member (Owner only; the last Owner is retained) */
        delete: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                    memberId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DocumentAccessResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/nodes": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List document nodes */
        get: {
            parameters: {
                query?: {
                    Depth?: number | string;
                    Fields?: string;
                    Kind?: string;
                    Limit?: number | string;
                    NamePrefix?: string;
                    Offset?: number | string;
                    /** @description Committed document revision to read; omitted selects the current revision. */
                    Revision?: number | string;
                    ScreenId?: string;
                    SemanticKey?: string;
                };
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["StructureResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/nodes/{nodeId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read a node */
        get: {
            parameters: {
                query?: {
                    Depth?: number | string;
                    Fields?: string;
                    Kind?: string;
                    Limit?: number | string;
                    NamePrefix?: string;
                    Offset?: number | string;
                    /** @description Committed document revision to read; omitted selects the current revision. */
                    Revision?: number | string;
                    ScreenId?: string;
                    SemanticKey?: string;
                };
                header?: never;
                path: {
                    documentId: string;
                    nodeId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["StructureResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/nodes/{nodeId}/repeater": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Evaluate saved local repeater data at one document revision
         * @description Returns relative scalar values by template node ID and item order, or the empty view ID for zero items. Offset is nonnegative and limit is 1–100. Missing or invalid fixture fields appear as diagnostics without changing the document. No live data is fetched.
         */
        get: {
            parameters: {
                query?: {
                    limit?: number | string;
                    offset?: number | string;
                    revision?: number | string;
                };
                header?: never;
                path: {
                    documentId: string;
                    nodeId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["RepeaterEvaluationResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/pages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List document pages */
        get: {
            parameters: {
                query?: {
                    Depth?: number | string;
                    Fields?: string;
                    Kind?: string;
                    Limit?: number | string;
                    NamePrefix?: string;
                    Offset?: number | string;
                    /** @description Committed document revision to read; omitted selects the current revision. */
                    Revision?: number | string;
                    ScreenId?: string;
                    SemanticKey?: string;
                };
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["StructureResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/pages/{pageId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read a page */
        get: {
            parameters: {
                query?: {
                    Depth?: number | string;
                    Fields?: string;
                    Kind?: string;
                    Limit?: number | string;
                    NamePrefix?: string;
                    Offset?: number | string;
                    /** @description Committed document revision to read; omitted selects the current revision. */
                    Revision?: number | string;
                    ScreenId?: string;
                    SemanticKey?: string;
                };
                header?: never;
                path: {
                    documentId: string;
                    pageId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["StructureResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/pages/{pageId}/screens": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List ordered screens on a page */
        get: {
            parameters: {
                query?: {
                    Depth?: number | string;
                    Fields?: string;
                    Kind?: string;
                    Limit?: number | string;
                    NamePrefix?: string;
                    Offset?: number | string;
                    /** @description Committed document revision to read; omitted selects the current revision. */
                    Revision?: number | string;
                    ScreenId?: string;
                    SemanticKey?: string;
                };
                header?: never;
                path: {
                    documentId: string;
                    pageId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["StructureResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/presence": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read document presence */
        get: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["PresenceParticipantsResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        /** Update document presence */
        put: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["PresenceUpdateRequest"];
                    "application/json": components["schemas"]["PresenceUpdateRequest"];
                    "text/json": components["schemas"]["PresenceUpdateRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["PresenceUpdateResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/preview": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Replay a bounded sequence of saved prototype events without mutating the document */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["PreviewPlaybackRequest"];
                    "application/json": components["schemas"]["PreviewPlaybackRequest"];
                    "text/json": components["schemas"]["PreviewPlaybackRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DocumentPreview"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/profile": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read the Portable UI Profile capabilities at a document revision */
        get: {
            parameters: {
                query?: {
                    revision?: number | string;
                };
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DocumentProfileResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/reconnect": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Recover document changes */
        get: {
            parameters: {
                query?: {
                    lastSeenRevision?: number | string;
                };
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ReconnectResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/resources/css": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Export revision-scoped neutral design resources and themed CSS declarations
         * @description Both theme values and original reference IDs are preserved in resources. Css uses explicit data-figvam-theme=Light/Dark selection, stable custom property names and reusable style classes. Null Css and diagnostics indicate an invalid or non-exportable document.
         */
        get: {
            parameters: {
                query?: {
                    revision?: number | string;
                };
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["CssResourcesResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/revision-diff": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Compare two document revisions */
        get: {
            parameters: {
                query?: {
                    fromRevision?: number | string;
                    limit?: number | string;
                    offset?: number | string;
                    toRevision?: number | string;
                };
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["RevisionDiffResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/scenario-capabilities": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Read profile-supported scenario choices for a node and target at a document revision
         * @description The returned actions are evaluated for the supplied target. Events are evaluated for the node kind. Requery when the revision, node, target, screen, variant, dataset, demo node or demo value changes. Supply demoValue in the JSON body, including null or an empty string; command validation remains authoritative.
         */
        post: {
            parameters: {
                query?: {
                    datasetId?: string;
                    demoNodeId?: string;
                    nodeId?: string;
                    revision?: number | string;
                    screenId?: string;
                    targetId?: string;
                    variantId?: string;
                };
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody: {
                content: {
                    "application/*+json": components["schemas"]["ScenarioCapabilitiesValueRequest"];
                    "application/json": components["schemas"]["ScenarioCapabilitiesValueRequest"];
                    "text/json": components["schemas"]["ScenarioCapabilitiesValueRequest"];
                };
            };
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ScenarioCapabilitiesResponse"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/scenarios": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read saved prototype scenarios at a consistent revision
         * @description Optional screenId and scenarioId filters. Offset is nonnegative; limit is 1-100. Revision is optional. Responses contain only local demo values saved by editors.
         */
        get: {
            parameters: {
                query?: {
                    limit?: number | string;
                    offset?: number | string;
                    revision?: number | string;
                    scenarioId?: string;
                    screenId?: string;
                };
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ScenariosResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/screens": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List document screens */
        get: {
            parameters: {
                query?: {
                    Depth?: number | string;
                    Fields?: string;
                    Kind?: string;
                    Limit?: number | string;
                    NamePrefix?: string;
                    Offset?: number | string;
                    /** @description Committed document revision to read; omitted selects the current revision. */
                    Revision?: number | string;
                    ScreenId?: string;
                    SemanticKey?: string;
                };
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["StructureResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/screens/{screenId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read a screen */
        get: {
            parameters: {
                query?: {
                    Depth?: number | string;
                    Fields?: string;
                    Kind?: string;
                    Limit?: number | string;
                    NamePrefix?: string;
                    Offset?: number | string;
                    /** @description Committed document revision to read; omitted selects the current revision. */
                    Revision?: number | string;
                    ScreenId?: string;
                    SemanticKey?: string;
                };
                header?: never;
                path: {
                    documentId: string;
                    screenId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["StructureResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/screens/{screenId}/layout": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read reference bounds, clipping and layout diagnostics for a screen */
        get: {
            parameters: {
                query?: {
                    datasetId?: string;
                    limit?: number | string;
                    offset?: number | string;
                    previewHeight?: number | string;
                    previewWidth?: number | string;
                    revision?: number | string;
                    theme?: components["schemas"]["TokenTheme"];
                    variantId?: string;
                };
                header?: never;
                path: {
                    documentId: string;
                    screenId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ScreenLayoutResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/screens/{screenId}/variant-diff": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Compare effective screen variant properties
         * @description Omit either variant ID to select the base state. Both variants must belong to the specified screen at the selected revision. Results contain node IDs and property names only, ordered by node ID and property. Offset is nonnegative and limit is 1-100.
         */
        get: {
            parameters: {
                query?: {
                    fromVariantId?: string;
                    limit?: number | string;
                    offset?: number | string;
                    revision?: number | string;
                    toVariantId?: string;
                };
                header?: never;
                path: {
                    documentId: string;
                    screenId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ScreenVariantDiffResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/screens/{screenId}/variants": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Read saved screen variants and property differences at one revision
         * @description Optional variantId selects one variant. Offset is nonnegative; limit is 1-100. Omitted overrides inherit base node properties. Component variants are independent entities.
         */
        get: {
            parameters: {
                query?: {
                    limit?: number | string;
                    offset?: number | string;
                    revision?: number | string;
                    variantId?: string;
                };
                header?: never;
                path: {
                    documentId: string;
                    screenId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ScreenVariantsResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/styles": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List document design styles at a given revision */
        get: {
            parameters: {
                query?: {
                    limit?: number | string;
                    offset?: number | string;
                    revision?: number | string;
                };
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["StyleListResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/styles/{styleId}/usages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List direct and transitive style usages at a document revision */
        get: {
            parameters: {
                query?: {
                    limit?: number | string;
                    offset?: number | string;
                    revision?: number | string;
                };
                header?: never;
                path: {
                    documentId: string;
                    styleId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["StyleUsagesResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/token-export": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * Export design tokens in DTCG 2025.10 format
         * @description Select Light or Dark, optionally by revision. DTCG 2025.10 includes nested groups, typography, token aliases, and org.figvam metadata for stable IDs, legacy types and semantic categories. A null tokens object and diagnostics mean lossless export is impossible. At most 1000 tokens and 1 MiB of token JSON are supported.
         */
        get: {
            parameters: {
                query?: {
                    revision?: number | string;
                    theme?: string;
                };
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["TokenExportResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/tokens": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List tokens at a document revision */
        get: {
            parameters: {
                query?: {
                    limit?: number | string;
                    offset?: number | string;
                    revision?: number | string;
                };
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["TokenListResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/tokens/{tokenId}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Read a token at a document revision */
        get: {
            parameters: {
                query?: {
                    revision?: number | string;
                };
                header?: never;
                path: {
                    documentId: string;
                    tokenId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["TokenResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/tokens/{tokenId}/usages": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /**
         * List direct and indirect token usages with resource dependency chains
         * @description Usages contain kind, ownerId, property, theme, indirect flag, owner label and a chain of IDs from the requested token to its consumer. Read against a specific revision for reproducible results.
         */
        get: {
            parameters: {
                query?: {
                    limit?: number | string;
                    offset?: number | string;
                    revision?: number | string;
                };
                header?: never;
                path: {
                    documentId: string;
                    tokenId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["TokenUsagesResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/{documentId}/versions": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List saved document versions */
        get: {
            parameters: {
                query?: {
                    beforeRevision?: number | string;
                    limit?: number | string;
                };
                header?: never;
                path: {
                    documentId: string;
                };
                cookie?: never;
            };
            requestBody?: never;
            responses: {
                /** @description OK */
                200: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["VersionHistoryResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Not Found */
                404: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/import/container.figvam": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Reopen a version-1 .figvam container as a new document
         * @description Raw ZIP body, at most 84148224 bytes. Contains manifest.json, document.json and selected safe PNG assets. Validates paths, bounds, schemas, references, sizes, hashes and raster metadata before atomically storing all content, revision zero and Owner. No multipart envelope.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            /** @description Raw binary ZIP container; manifest schema: /api/v1/schemas/manifest-v1.json. Maximum 16842752 bytes. */
            requestBody: {
                content: {
                    "application/zip": string;
                };
            };
            responses: {
                /** @description Created */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DocumentImportResponse"];
                        "text/json": components["schemas"]["DocumentImportResponse"];
                        "text/plain": components["schemas"]["DocumentImportResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DocumentImportFailure"];
                        "text/json": components["schemas"]["DocumentImportFailure"];
                        "text/plain": components["schemas"]["DocumentImportFailure"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "text/json": components["schemas"]["ApiError"];
                        "text/plain": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "text/json": components["schemas"]["ApiError"];
                        "text/plain": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "text/json": components["schemas"]["ApiError"];
                        "text/plain": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "text/json": components["schemas"]["ApiError"];
                        "text/plain": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "text/json": components["schemas"]["ApiError"];
                        "text/plain": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "text/json": components["schemas"]["ApiError"];
                        "text/plain": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "text/json": components["schemas"]["ApiError"];
                        "text/plain": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/api/v1/documents/import/document.json": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Reopen a version-1 document.json as a new document
         * @description Raw document-v1.json schema body, at most 16777216 bytes. Preserves document and technical IDs; authenticated actor becomes Owner. Creates local revision 0 without source versions, members or command history. Existing ID returns 409 without modification. Validation diagnostics include codes and paths.
         */
        post: {
            parameters: {
                query?: never;
                header?: never;
                path?: never;
                cookie?: never;
            };
            /** @description Raw document file; complete schema: /api/v1/schemas/document-v1.json. Maximum 16777216 bytes. */
            requestBody: {
                content: {
                    "application/json": Record<string, never>;
                };
            };
            responses: {
                /** @description Created */
                201: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DocumentImportResponse"];
                        "text/json": components["schemas"]["DocumentImportResponse"];
                        "text/plain": components["schemas"]["DocumentImportResponse"];
                    };
                };
                /** @description Bad Request */
                400: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["DocumentImportFailure"];
                        "text/json": components["schemas"]["DocumentImportFailure"];
                        "text/plain": components["schemas"]["DocumentImportFailure"];
                    };
                };
                /** @description Unauthorized */
                401: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "text/json": components["schemas"]["ApiError"];
                        "text/plain": components["schemas"]["ApiError"];
                    };
                };
                /** @description Forbidden */
                403: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "text/json": components["schemas"]["ApiError"];
                        "text/plain": components["schemas"]["ApiError"];
                    };
                };
                /** @description Conflict */
                409: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "text/json": components["schemas"]["ApiError"];
                        "text/plain": components["schemas"]["ApiError"];
                    };
                };
                /** @description Payload Too Large */
                413: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "text/json": components["schemas"]["ApiError"];
                        "text/plain": components["schemas"]["ApiError"];
                    };
                };
                /** @description Unsupported Media Type */
                415: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "text/json": components["schemas"]["ApiError"];
                        "text/plain": components["schemas"]["ApiError"];
                    };
                };
                /** @description Too Many Requests */
                429: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "text/json": components["schemas"]["ApiError"];
                        "text/plain": components["schemas"]["ApiError"];
                    };
                };
                /** @description Internal Server Error */
                500: {
                    headers: {
                        [name: string]: unknown;
                    };
                    content: {
                        "application/json": components["schemas"]["ApiError"];
                        "text/json": components["schemas"]["ApiError"];
                        "text/plain": components["schemas"]["ApiError"];
                    };
                };
            };
        };
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        AddComponentDefinitionRequest: {
            /** Format: uuid */
            commandId: string;
            /** Format: uuid */
            componentId: string;
            description: string;
            name: string;
            /** Format: uuid */
            rootNodeId: string;
        };
        AddComponentParameterRequest: {
            /** Format: uuid */
            commandId: string;
            defaultValue: components["schemas"]["ComponentValue"];
            /** Format: uuid */
            definitionId: string;
            enumValues?: null | string[];
            name: string;
            /** Format: uuid */
            nodeId: string;
            /** Format: uuid */
            parameterId: string;
            property: string;
            styleType?: null | components["schemas"]["DesignStyleType"];
            tokenCategory?: null | components["schemas"]["TokenCategory"];
            tokenType?: null | components["schemas"]["TokenType"];
            type: components["schemas"]["ComponentParameterType"];
        };
        AddComponentSlotRequest: {
            /** Format: uuid */
            commandId: string;
            /** Format: uuid */
            containerNodeId: string;
            /** Format: uuid */
            definitionId: string;
            name: string;
            /** Format: uuid */
            slotId: string;
        };
        AddComponentVariantRequest: {
            /** Format: uuid */
            baseVariantId?: null | string;
            /** Format: uuid */
            commandId: string;
            /** Format: uuid */
            definitionId: string;
            kind: components["schemas"]["ComponentVariantKind"];
            name: string;
            parameterChanges: {
                [key: string]: components["schemas"]["ComponentValue"];
            };
            /** Format: uuid */
            variantId: string;
        };
        AddCsvDatasetRequest: {
            /** Format: uuid */
            commandId: string;
            csv: string;
            /** Format: uuid */
            datasetId: string;
            name: string;
        };
        AddDatasetRequest: {
            /** Format: uuid */
            commandId: string;
            /** Format: uuid */
            datasetId: string;
            fixtureJson: string;
            name: string;
        };
        AddNodeRequest: {
            /** Format: uuid */
            commandId: string;
            kind: string;
            name?: null | string;
            /** Format: uuid */
            nodeId: string;
            /** Format: uuid */
            parentId: string;
            properties?: null | {
                [key: string]: components["schemas"]["NodePropertyValue"];
            };
        };
        AddPageRequest: {
            /** Format: uuid */
            commandId: string;
            name?: null | string;
            /** Format: uuid */
            pageId: string;
        };
        AddScreenRequest: {
            /** Format: uuid */
            commandId: string;
            dimensions: components["schemas"]["ScreenDimensions"];
            name?: null | string;
            /** Format: uuid */
            pageId: string;
            /** Format: uuid */
            screenId: string;
        };
        AddScreenVariantRequest: {
            /** Format: uuid */
            commandId: string;
            name: string;
            /** Format: uuid */
            screenId: string;
            /** Format: uuid */
            variantId: string;
        };
        AddTokenRequest: {
            category?: null | components["schemas"]["TokenCategory"];
            /** Format: uuid */
            commandId: string;
            name: string;
            /** Format: uuid */
            tokenId: string;
            type: components["schemas"]["TokenType"];
            values: {
                [key: string]: components["schemas"]["TokenExpression"];
            };
        };
        ApiError: {
            code: string;
            detail: string;
            diagnostics?: null | components["schemas"]["TokenImportDiagnostic"][];
            /** Format: uuid */
            nodeId?: null | string;
            property?: null | string;
            /** Format: int32 */
            status: number | string;
            title: string;
            type: string;
        };
        BindNodeDataRequest: {
            binding: components["schemas"]["NodeDataBinding"];
            /** Format: uuid */
            commandId: string;
            /** Format: uuid */
            nodeId: string;
            property: string;
        };
        CommandResponse: {
            affectedIds: string[];
            /** Format: uuid */
            commandId: string;
            /** Format: uuid */
            documentId: string;
            /** Format: uuid */
            nodeId: null | string;
            /** Format: uuid */
            pageId: null | string;
            /** Format: int64 */
            revision: number | string;
            /** Format: uuid */
            screenId: null | string;
            status: string;
            /** Format: uuid */
            versionId: null | string;
        };
        CommittedDocumentEvent: {
            actorId: string;
            /** Format: uuid */
            commandId: string;
            /** Format: uuid */
            documentId: string;
            payload: components["schemas"]["DocumentEvent"];
            /** Format: int64 */
            revision: number | string;
            source?: string;
            type: string;
        };
        ComponentDefinition: {
            bindings?: components["schemas"]["ComponentParameterBinding"][];
            description: string;
            /** Format: uuid */
            id: string;
            name: string;
            parameters: components["schemas"]["ComponentParameter"][];
            /** Format: uuid */
            rootNodeId: string;
            slots: components["schemas"]["ComponentSlot"][];
            variants: components["schemas"]["ComponentVariant"][];
        };
        ComponentInstance: {
            /** Format: uuid */
            definitionId: string;
            /** Format: uuid */
            nodeId: string;
            parameterOverrides: {
                [key: string]: components["schemas"]["ComponentValue"];
            };
            slotContent: {
                [key: string]: string[];
            };
            /** Format: uuid */
            variantId: null | string;
        };
        ComponentListResponse: {
            /** Format: uuid */
            documentId: string;
            items: components["schemas"]["ComponentDefinition"][];
            /** Format: int32 */
            limit: number | string;
            /** Format: int32 */
            offset: number | string;
            /** Format: int64 */
            revision: number | string;
            /** Format: int32 */
            total: number | string;
        };
        ComponentParameter: {
            defaultValue: components["schemas"]["ComponentValue"];
            enumValues?: null | string[];
            /** Format: uuid */
            id: string;
            name: string;
            styleType?: null | components["schemas"]["DesignStyleType"];
            tokenCategory?: null | components["schemas"]["TokenCategory"];
            tokenType?: null | components["schemas"]["TokenType"];
            type: components["schemas"]["ComponentParameterType"];
        };
        ComponentParameterBinding: {
            /** Format: uuid */
            nodeId: string;
            /** Format: uuid */
            parameterId: string;
            property: string;
        };
        ComponentParameterType: number;
        ComponentReplacementRequest: {
            /** Format: uuid */
            definitionId: string;
            parameterIds: {
                [key: string]: string;
            };
            slotIds: {
                [key: string]: string;
            };
            variantIds: {
                [key: string]: string;
            };
        };
        ComponentResponse: {
            component: components["schemas"]["ComponentDefinition"];
            /** Format: uuid */
            documentId: string;
            /** Format: int64 */
            revision: number | string;
        };
        ComponentSlot: {
            /** Format: uuid */
            containerNodeId: string;
            /** Format: uuid */
            id: string;
            name: string;
        };
        ComponentUsagesResponse: {
            /** Format: uuid */
            componentId: string;
            /** Format: uuid */
            documentId: string;
            items: components["schemas"]["ComponentInstance"][];
            /** Format: int32 */
            limit: number | string;
            /** Format: int32 */
            offset: number | string;
            /** Format: int64 */
            revision: number | string;
            /** Format: int32 */
            total: number | string;
        };
        ComponentValue: components["schemas"]["ComponentValueComponentText"] | components["schemas"]["ComponentValueComponentAsset"] | components["schemas"]["ComponentValueComponentBool"] | components["schemas"]["ComponentValueComponentNumber"] | components["schemas"]["ComponentValueComponentToken"] | components["schemas"]["ComponentValueComponentStyle"] | components["schemas"]["ComponentValueComponentEnum"];
        ComponentValueComponentAsset: {
            /** Format: uuid */
            assetId: string;
            /** @enum {string} */
            valueType?: "asset";
        };
        ComponentValueComponentBool: {
            value: boolean;
            /** @enum {string} */
            valueType?: "bool";
        };
        ComponentValueComponentEnum: {
            value: string;
            /** @enum {string} */
            valueType?: "enum";
        };
        ComponentValueComponentNumber: {
            /** Format: double */
            value: number | string;
            /** @enum {string} */
            valueType?: "number";
        };
        ComponentValueComponentStyle: {
            /** Format: uuid */
            styleId: string;
            /** @enum {string} */
            valueType?: "style";
        };
        ComponentValueComponentText: {
            value: string;
            /** @enum {string} */
            valueType?: "text";
        };
        ComponentValueComponentToken: {
            /** Format: uuid */
            tokenId: string;
            /** @enum {string} */
            valueType?: "token";
        };
        ComponentVariant: {
            /** Format: uuid */
            baseVariantId: null | string;
            /** Format: uuid */
            id: string;
            kind: components["schemas"]["ComponentVariantKind"];
            name: string;
            parameterChanges: {
                [key: string]: components["schemas"]["ComponentValue"];
            };
        };
        ComponentVariantKind: number;
        CreateDocumentRequest: {
            /** Format: uuid */
            documentId: string;
            name: string;
        };
        CreateScenarioRequest: {
            /** Format: uuid */
            commandId: string;
            /** Format: int64 */
            expectedRevision?: null | number | string;
            scenario: components["schemas"]["PreviewScenario"];
        };
        CssResourcesResponse: {
            css: null | string;
            /** Format: uuid */
            documentId: string;
            resources: components["schemas"]["PortableResourceSnapshot"];
            /** Format: int64 */
            revision: number | string;
        };
        DataBinding: {
            expectedType?: components["schemas"]["DataExpectedType"];
            operation?: components["schemas"]["DataOperation"];
            path: components["schemas"]["DataPathSegment"][];
        };
        DataDiagnostic: {
            code: string;
            message: string;
        };
        /** @default 0 */
        DataExpectedType: number;
        /** @default 0 */
        DataOperation: number;
        DataPathSegment: components["schemas"]["DataPathSegmentDataProperty"] | components["schemas"]["DataPathSegmentDataIndex"];
        DataPathSegmentDataIndex: {
            /** Format: int32 */
            index: number | string;
            /** @enum {string} */
            type?: "index";
        };
        DataPathSegmentDataProperty: {
            name: string;
            /** @enum {string} */
            type?: "property";
        };
        DatasetFixtureResponse: {
            /** Format: uuid */
            datasetId: string;
            /** Format: uuid */
            documentId: string;
            fixtureJson: string;
            /** Format: int64 */
            revision: number | string;
        };
        DatasetListResponse: {
            /** Format: uuid */
            documentId: string;
            items: components["schemas"]["DatasetSummary"][];
            /** Format: int32 */
            limit: number | string;
            /** Format: int32 */
            offset: number | string;
            /** Format: int64 */
            revision: number | string;
            /** Format: int32 */
            total: number | string;
        };
        DatasetResponse: {
            dataset: components["schemas"]["DatasetSummary"];
            /** Format: uuid */
            documentId: string;
            /** Format: int64 */
            revision: number | string;
        };
        DatasetSummary: {
            connectorId?: null | string;
            /** Format: int32 */
            fixtureBytes: number | string;
            /** Format: uuid */
            id: string;
            name: string;
        };
        DeleteComponentDefinitionRequest: {
            /** Format: uuid */
            commandId: string;
            /** Format: uuid */
            definitionId: string;
            /** Format: int64 */
            expectedRevision: number | string;
            replacement?: null | components["schemas"]["ComponentReplacementRequest"];
        };
        DeleteDatasetRequest: {
            /** Format: uuid */
            commandId: string;
            /** Format: uuid */
            datasetId: string;
            /** Format: int64 */
            expectedRevision: number | string;
        };
        DeleteDocumentRequest: {
            /** Format: uuid */
            commandId: string;
            /** Format: int64 */
            expectedRevision: number | string;
        };
        DeleteNodeRequest: {
            /** Format: uuid */
            commandId: string;
            /** Format: uuid */
            nodeId: string;
        };
        DeletePageRequest: {
            /** Format: uuid */
            commandId: string;
            /** Format: int64 */
            expectedRevision: number | string;
            /** Format: uuid */
            pageId: string;
        };
        DeleteScenarioRequest: {
            /** Format: uuid */
            commandId: string;
            /** Format: int64 */
            expectedRevision: number | string;
            /** Format: uuid */
            scenarioId: string;
        };
        DeleteScreenRequest: {
            /** Format: uuid */
            commandId: string;
            /** Format: int64 */
            expectedRevision: number | string;
            /** Format: uuid */
            screenId: string;
        };
        DeleteStyleRequest: {
            /** Format: uuid */
            commandId: string;
            /** Format: int64 */
            expectedRevision: number | string;
            /** Format: uuid */
            styleId: string;
        };
        DeleteTokenRequest: {
            /** Format: uuid */
            commandId: string;
            /** Format: int64 */
            expectedRevision: number | string;
            /** Format: uuid */
            tokenId: string;
        };
        DesignResourceUse: {
            chain: string[];
            indirect: boolean;
            kind: string;
            label: string;
            /** Format: uuid */
            ownerId: string;
            /** Format: uuid */
            parameterId: null | string;
            property: null | string;
            theme: null | components["schemas"]["TokenTheme"];
        };
        DesignStyle: {
            /** Format: uuid */
            basedOnStyleId?: null | string;
            fields: {
                [key: string]: components["schemas"]["NodePropertyValue"];
            };
            /** Format: uuid */
            id: string;
            name: string;
            type: components["schemas"]["DesignStyleType"];
        };
        DesignStyleType: number;
        DesignToken: {
            category?: null | components["schemas"]["TokenCategory"];
            /** Format: uuid */
            id: string;
            name: string;
            type: components["schemas"]["TokenType"];
            values: {
                [key: string]: components["schemas"]["TokenExpression"];
            };
        };
        DetachComponentInstanceRequest: {
            /** Format: uuid */
            commandId: string;
            /** Format: int64 */
            expectedRevision: number | string;
            /** Format: uuid */
            nodeId: string;
        };
        DocumentAccessResponse: {
            code: string;
            /** Format: uuid */
            documentId: string;
        };
        DocumentActor: {
            id: string;
        };
        DocumentAsset: {
            /** Format: int32 */
            byteLength: number | string;
            contentType: string;
            /** Format: int32 */
            height: number | string;
            /** Format: uuid */
            id: string;
            sha256: string;
            /** Format: int32 */
            width: number | string;
        };
        DocumentAssetsResponse: {
            assets: components["schemas"]["DocumentAsset"][];
            /** Format: uuid */
            documentId: string;
            fonts?: components["schemas"]["DocumentFontFamily"][];
            /** Format: int64 */
            revision: number | string;
        };
        DocumentDataset: {
            connectorId?: null | string;
            fixtureJson: string;
            /** Format: uuid */
            id: string;
            name: string;
        };
        DocumentEvent: components["schemas"]["DocumentEventScenarioChanged"] | components["schemas"]["DocumentEventScreenVariantChanged"] | components["schemas"]["DocumentEventComponentSlotAdded"] | components["schemas"]["DocumentEventComponentSlotContentSet"] | components["schemas"]["DocumentEventComponentVariantAdded"] | components["schemas"]["DocumentEventComponentInstanceVariantSet"] | components["schemas"]["DocumentEventComponentDefinitionDeleted"] | components["schemas"]["DocumentEventComponentInstanceDetached"] | components["schemas"]["DocumentEventComponentInstanceInserted"] | components["schemas"]["DocumentEventComponentVariantParameterChangeSet"] | components["schemas"]["DocumentEventComponentParameterDefaultSet"] | components["schemas"]["DocumentEventComponentParameterOverrideSet"] | components["schemas"]["DocumentEventComponentParameterAdded"] | components["schemas"]["DocumentEventComponentDefinitionAdded"] | components["schemas"]["DocumentEventNodeRepeaterSet"] | components["schemas"]["DocumentEventNodeDataBindingSet"] | components["schemas"]["DocumentEventDatasetConnectorSet"] | components["schemas"]["DocumentEventDatasetDeleted"] | components["schemas"]["DocumentEventDatasetAdded"] | components["schemas"]["DocumentEventDatasetFixtureReplaced"] | components["schemas"]["DocumentEventTokensImported"] | components["schemas"]["DocumentEventTokenAdded"] | components["schemas"]["DocumentEventTokenDeleted"] | components["schemas"]["DocumentEventStyleUpserted"] | components["schemas"]["DocumentEventStyleDeleted"] | components["schemas"]["DocumentEventNodePropertiesRemoved"] | components["schemas"]["DocumentEventTokenValueSet"] | components["schemas"]["DocumentEventTokenRenamed"] | components["schemas"]["DocumentEventAssetAdded"] | components["schemas"]["DocumentEventPageDeleted"] | components["schemas"]["DocumentEventScreenDeleted"] | components["schemas"]["DocumentEventPageAdded"] | components["schemas"]["DocumentEventDocumentDeleted"] | components["schemas"]["DocumentEventDocumentRenamed"] | components["schemas"]["DocumentEventPageRenamed"] | components["schemas"]["DocumentEventScreenRenamed"] | components["schemas"]["DocumentEventScreenResized"] | components["schemas"]["DocumentEventScreenAdded"] | components["schemas"]["DocumentEventScreenDuplicated"] | components["schemas"]["DocumentEventNodeAdded"] | components["schemas"]["DocumentEventNodeMoved"] | components["schemas"]["DocumentEventNodeDeleted"] | components["schemas"]["DocumentEventNodeNameSet"] | components["schemas"]["DocumentEventNodeSemanticKeySet"] | components["schemas"]["DocumentEventNodePropertySet"] | components["schemas"]["DocumentEventNodePropertiesSet"] | components["schemas"]["DocumentEventVersionSaved"] | components["schemas"]["DocumentEventVersionRestored"] | components["schemas"]["DocumentEventHistoryCompensated"] | components["schemas"]["DocumentEventBatchApplied"];
        DocumentEventAssetAdded: {
            asset: components["schemas"]["DocumentAsset"];
            fontFamily?: null | components["schemas"]["DocumentFontFamily"];
            /** @enum {string} */
            payloadType?: "ASSET_ADDED";
        };
        DocumentEventBatchApplied: {
            patch: components["schemas"]["DocumentPatch"];
            /** @enum {string} */
            payloadType?: "BATCH_APPLIED";
        };
        DocumentEventComponentDefinitionAdded: {
            definition: components["schemas"]["ComponentDefinition"];
            /** @enum {string} */
            payloadType?: "COMPONENT_DEFINITION_ADDED";
        };
        DocumentEventComponentDefinitionDeleted: {
            /** Format: uuid */
            definitionId: string;
            patch: components["schemas"]["DocumentPatch"];
            /** @enum {string} */
            payloadType?: "COMPONENT_DEFINITION_DELETED";
        };
        DocumentEventComponentInstanceDetached: {
            /** Format: uuid */
            nodeId: string;
            patch: components["schemas"]["DocumentPatch"];
            /** @enum {string} */
            payloadType?: "COMPONENT_INSTANCE_DETACHED";
        };
        DocumentEventComponentInstanceInserted: {
            anchor: components["schemas"]["NodeStructure"];
            instance: components["schemas"]["ComponentInstance"];
            /** Format: uuid */
            parentId: string;
            /** @enum {string} */
            payloadType?: "COMPONENT_INSTANCE_INSERTED";
            /** Format: int32 */
            position: number | string;
        };
        DocumentEventComponentInstanceVariantSet: {
            /** Format: uuid */
            nodeId: string;
            /** @enum {string} */
            payloadType?: "COMPONENT_INSTANCE_VARIANT_SET";
            /** Format: uuid */
            variantId: null | string;
        };
        DocumentEventComponentParameterAdded: {
            binding: components["schemas"]["ComponentParameterBinding"];
            /** Format: uuid */
            definitionId: string;
            parameter: components["schemas"]["ComponentParameter"];
            /** @enum {string} */
            payloadType?: "COMPONENT_PARAMETER_ADDED";
        };
        DocumentEventComponentParameterDefaultSet: {
            /** Format: uuid */
            definitionId: string;
            /** Format: uuid */
            parameterId: string;
            /** @enum {string} */
            payloadType?: "COMPONENT_PARAMETER_DEFAULT_SET";
            value: components["schemas"]["ComponentValue"];
        };
        DocumentEventComponentParameterOverrideSet: {
            /** Format: uuid */
            nodeId: string;
            /** Format: uuid */
            parameterId: string;
            /** @enum {string} */
            payloadType?: "COMPONENT_PARAMETER_OVERRIDE_SET";
            value: null | components["schemas"]["ComponentValue"];
        };
        DocumentEventComponentSlotAdded: {
            /** Format: uuid */
            definitionId: string;
            /** @enum {string} */
            payloadType?: "COMPONENT_SLOT_ADDED";
            slot: components["schemas"]["ComponentSlot"];
        };
        DocumentEventComponentSlotContentSet: {
            contentNodeIds: string[];
            /** Format: uuid */
            nodeId: string;
            /** @enum {string} */
            payloadType?: "COMPONENT_SLOT_CONTENT_SET";
            /** Format: uuid */
            slotId: string;
        };
        DocumentEventComponentVariantAdded: {
            /** Format: uuid */
            definitionId: string;
            /** @enum {string} */
            payloadType?: "COMPONENT_VARIANT_ADDED";
            variant: components["schemas"]["ComponentVariant"];
        };
        DocumentEventComponentVariantParameterChangeSet: {
            /** Format: uuid */
            definitionId: string;
            /** Format: uuid */
            parameterId: string;
            /** @enum {string} */
            payloadType?: "COMPONENT_VARIANT_PARAMETER_CHANGE_SET";
            value: null | components["schemas"]["ComponentValue"];
            /** Format: uuid */
            variantId: string;
        };
        DocumentEventDatasetAdded: {
            dataset: components["schemas"]["DocumentDataset"];
            /** @enum {string} */
            payloadType?: "DATASET_ADDED";
        };
        DocumentEventDatasetConnectorSet: {
            connectorId: null | string;
            /** Format: uuid */
            datasetId: string;
            /** @enum {string} */
            payloadType?: "DATASET_CONNECTOR_SET";
        };
        DocumentEventDatasetDeleted: {
            /** Format: uuid */
            datasetId: string;
            /** @enum {string} */
            payloadType?: "DATASET_DELETED";
        };
        DocumentEventDatasetFixtureReplaced: {
            /** Format: uuid */
            datasetId: string;
            fixtureJson: string;
            /** @enum {string} */
            payloadType?: "DATASET_FIXTURE_REPLACED";
        };
        DocumentEventDocumentDeleted: {
            /** @enum {string} */
            payloadType?: "DOCUMENT_DELETED";
        };
        DocumentEventDocumentRenamed: {
            name: string;
            /** @enum {string} */
            payloadType?: "DOCUMENT_RENAMED";
        };
        DocumentEventHistoryCompensated: {
            isRedo: boolean;
            patch: components["schemas"]["DocumentPatch"];
            /** @enum {string} */
            payloadType?: "HISTORY_COMPENSATED";
            /** Format: uuid */
            targetCommandId: string;
        };
        DocumentEventNodeAdded: {
            kind: string;
            name?: null | string;
            /** Format: uuid */
            nodeId: string;
            /** Format: uuid */
            parentId: string;
            /** @enum {string} */
            payloadType?: "NODE_ADDED";
            properties?: null | {
                [key: string]: components["schemas"]["NodePropertyValue"];
            };
        };
        DocumentEventNodeDataBindingSet: {
            binding: null | components["schemas"]["NodeDataBinding"];
            /** Format: uuid */
            nodeId: string;
            /** @enum {string} */
            payloadType?: "NODE_DATA_BINDING_SET";
            property: string;
        };
        DocumentEventNodeDeleted: {
            /** Format: uuid */
            nodeId: string;
            /** @enum {string} */
            payloadType?: "NODE_DELETED";
        };
        DocumentEventNodeMoved: {
            /** Format: uuid */
            nodeId: string;
            /** @enum {string} */
            payloadType?: "NODE_MOVED";
            /** Format: int32 */
            position: number | string;
            /** Format: uuid */
            targetParentId: string;
        };
        DocumentEventNodeNameSet: {
            name: string;
            /** Format: uuid */
            nodeId: string;
            /** @enum {string} */
            payloadType?: "NODE_NAME_SET";
        };
        DocumentEventNodePropertiesRemoved: {
            /** Format: uuid */
            nodeId: string;
            /** @enum {string} */
            payloadType?: "NODE_PROPERTIES_REMOVED";
            properties: string[];
        };
        DocumentEventNodePropertiesSet: {
            /** Format: uuid */
            nodeId: string;
            /** @enum {string} */
            payloadType?: "NODE_PROPERTIES_SET";
            properties: {
                [key: string]: components["schemas"]["NodePropertyValue"];
            };
        };
        DocumentEventNodePropertySet: {
            /** Format: uuid */
            nodeId: string;
            /** @enum {string} */
            payloadType?: "NODE_PROPERTY_SET";
            property: string;
            value: components["schemas"]["NodePropertyValue"];
        };
        DocumentEventNodeRepeaterSet: {
            /** Format: uuid */
            nodeId: string;
            /** @enum {string} */
            payloadType?: "NODE_REPEATER_SET";
            repeater: null | components["schemas"]["NodeRepeater"];
        };
        DocumentEventNodeSemanticKeySet: {
            /** Format: uuid */
            nodeId: string;
            /** @enum {string} */
            payloadType?: "NODE_SEMANTIC_KEY_SET";
            semanticKey: null | string;
        };
        DocumentEventPageAdded: {
            name?: null | string;
            /** Format: uuid */
            pageId: string;
            /** @enum {string} */
            payloadType?: "PAGE_ADDED";
        };
        DocumentEventPageDeleted: {
            /** Format: uuid */
            pageId: string;
            /** @enum {string} */
            payloadType?: "PAGE_DELETED";
        };
        DocumentEventPageRenamed: {
            name: string;
            /** Format: uuid */
            pageId: string;
            /** @enum {string} */
            payloadType?: "PAGE_RENAMED";
        };
        DocumentEventScenarioChanged: {
            operation: string;
            /** @enum {string} */
            payloadType?: "SCENARIO_CHANGED";
            scenario: null | components["schemas"]["PreviewScenario"];
            /** Format: uuid */
            scenarioId: string;
        };
        DocumentEventScreenAdded: {
            dimensions: components["schemas"]["ScreenDimensions"];
            name?: null | string;
            /** Format: uuid */
            pageId: string;
            /** @enum {string} */
            payloadType?: "SCREEN_ADDED";
            /** Format: uuid */
            screenId: string;
        };
        DocumentEventScreenDeleted: {
            /** @enum {string} */
            payloadType?: "SCREEN_DELETED";
            /** Format: uuid */
            screenId: string;
        };
        DocumentEventScreenDuplicated: {
            patch: components["schemas"]["DocumentPatch"];
            /** @enum {string} */
            payloadType?: "SCREEN_DUPLICATED";
            /** Format: uuid */
            screenId: string;
        };
        DocumentEventScreenRenamed: {
            name: string;
            /** @enum {string} */
            payloadType?: "SCREEN_RENAMED";
            /** Format: uuid */
            screenId: string;
        };
        DocumentEventScreenResized: {
            dimensions: components["schemas"]["ScreenDimensions"];
            /** @enum {string} */
            payloadType?: "SCREEN_RESIZED";
            /** Format: uuid */
            screenId: string;
        };
        DocumentEventScreenVariantChanged: {
            operation: string;
            /** @enum {string} */
            payloadType?: "SCREEN_VARIANT_CHANGED";
            /** Format: uuid */
            screenId: string;
            variant: components["schemas"]["ScreenVariant"];
        };
        DocumentEventStyleDeleted: {
            /** @enum {string} */
            payloadType?: "STYLE_DELETED";
            /** Format: uuid */
            styleId: string;
        };
        DocumentEventStyleUpserted: {
            /** @enum {string} */
            payloadType?: "STYLE_UPSERTED";
            style: components["schemas"]["DesignStyle"];
        };
        DocumentEventTokenAdded: {
            /** @enum {string} */
            payloadType?: "TOKEN_ADDED";
            token: components["schemas"]["DesignToken"];
        };
        DocumentEventTokenDeleted: {
            /** @enum {string} */
            payloadType?: "TOKEN_DELETED";
            /** Format: uuid */
            tokenId: string;
        };
        DocumentEventTokenRenamed: {
            name: string;
            /** @enum {string} */
            payloadType?: "TOKEN_RENAMED";
            /** Format: uuid */
            tokenId: string;
        };
        DocumentEventTokensImported: {
            /** @enum {string} */
            payloadType?: "TOKENS_IMPORTED";
            tokens: components["schemas"]["DesignToken"][];
        };
        DocumentEventTokenValueSet: {
            /** @enum {string} */
            payloadType?: "TOKEN_VALUE_SET";
            theme: components["schemas"]["TokenTheme"];
            /** Format: uuid */
            tokenId: string;
            value: components["schemas"]["TokenExpression"];
        };
        DocumentEventVersionRestored: {
            document: components["schemas"]["DocumentStructure"];
            /** @enum {string} */
            payloadType?: "VERSION_RESTORED";
            /** Format: uuid */
            versionId: string;
        };
        DocumentEventVersionSaved: {
            /** @enum {string} */
            payloadType?: "VERSION_SAVED";
            /** Format: uuid */
            versionId: string;
        };
        DocumentFontFace: {
            /** Format: uuid */
            assetId: string;
            /** Format: uuid */
            id: string;
            name: string;
            style: components["schemas"]["DocumentFontStyle"];
            /** Format: int32 */
            weightFrom: number | string;
            /** Format: int32 */
            weightTo: number | string;
        };
        DocumentFontFamily: {
            faces: components["schemas"]["DocumentFontFace"][];
            /** Format: uuid */
            id: string;
            name: string;
        };
        DocumentFontStyle: number;
        DocumentImportFailure: {
            code: string;
            diagnostics: components["schemas"]["DocumentReadDiagnostic"][];
        };
        DocumentImportResponse: {
            code: string;
            /** Format: uuid */
            documentId: string;
            /** Format: int64 */
            revision: number | string;
        };
        DocumentListItem: {
            compatibilityIssue?: null | string;
            /** Format: date-time */
            createdAt?: null | string;
            /** Format: int32 */
            currentProfileVersion?: number | string;
            /** Format: uuid */
            documentId: string;
            name: string;
            profileId?: null | string;
            /** Format: int32 */
            profileVersion?: null | number | string;
            /** Format: int64 */
            revision?: null | number | string;
            role: string;
            /** Format: int32 */
            storageSchemaVersion?: null | number | string;
            /** Format: date-time */
            updatedAt?: null | string;
        };
        DocumentListResponse: {
            items: components["schemas"]["DocumentListItem"][];
            /** Format: uuid */
            nextCursor: null | string;
        };
        DocumentPatch: {
            assets: components["schemas"]["EntityChangeOfDocumentAsset"][];
            componentDefinitions: components["schemas"]["EntityChangeOfComponentDefinition"][];
            componentInstances: components["schemas"]["EntityChangeOfComponentInstance"][];
            datasets: components["schemas"]["EntityChangeOfDocumentDataset"][];
            fonts?: components["schemas"]["EntityChangeOfDocumentFontFamily"][];
            name: null | components["schemas"]["NameChange"];
            nodes: components["schemas"]["EntityChangeOfNodeStructure"][];
            pages: components["schemas"]["EntityChangeOfPageStructure"][];
            scenarios: components["schemas"]["EntityChangeOfPreviewScenario"][];
            screens: components["schemas"]["EntityChangeOfScreenStructure"][];
            styles?: components["schemas"]["EntityChangeOfDesignStyle"][];
            tokens: components["schemas"]["EntityChangeOfDesignToken"][];
        };
        DocumentPreview: {
            /** Format: uuid */
            documentId: string;
            /** Format: int64 */
            revision: number | string;
            session: components["schemas"]["PreviewSession"];
        };
        DocumentProfileResponse: {
            /** Format: uuid */
            documentId: string;
            kinds: components["schemas"]["NodeKindDefinition"][];
            previewActions: string[];
            profile: components["schemas"]["PortableUiProfileReference"];
            /** Format: int64 */
            revision: number | string;
        };
        DocumentReadDiagnostic: {
            code: string;
            message: string;
            /** Format: uuid */
            objectId?: null | string;
            path: string;
            property?: null | string;
            /** Format: uuid */
            referenceId?: null | string;
        };
        DocumentState: {
            document: components["schemas"]["DocumentStructure"];
            /** Format: int64 */
            revision: number | string;
        };
        DocumentStructure: {
            assets: components["schemas"]["DocumentAsset"][];
            componentDefinitions: components["schemas"]["ComponentDefinition"][];
            componentInstances: components["schemas"]["ComponentInstance"][];
            datasets: components["schemas"]["DocumentDataset"][];
            fonts?: components["schemas"]["DocumentFontFamily"][];
            /** Format: uuid */
            id: string;
            name: string;
            nodes: components["schemas"]["NodeStructure"][];
            pages: components["schemas"]["PageStructure"][];
            profile: components["schemas"]["PortableUiProfileReference"];
            scenarios: components["schemas"]["PreviewScenario"][];
            screens: components["schemas"]["ScreenStructure"][];
            styles?: components["schemas"]["DesignStyle"][];
            tokens: components["schemas"]["DesignToken"][];
        };
        DocumentSubscriptionMessage: {
            change?: null | components["schemas"]["CommittedDocumentEvent"];
            code: string;
            /** Format: int64 */
            revision: number | string;
        };
        DuplicateScreenRequest: {
            /** Format: uuid */
            commandId: string;
            /** Format: int64 */
            expectedRevision: number | string;
            name?: null | string;
            /** Format: uuid */
            newScreenId: string;
            /** Format: uuid */
            screenId: string;
        };
        EntityChangeOfComponentDefinition: {
            after: null | components["schemas"]["ComponentDefinition"];
            /** Format: int32 */
            afterIndex: number | string;
            before: null | components["schemas"]["ComponentDefinition"];
            /** Format: int32 */
            beforeIndex: number | string;
            /** Format: uuid */
            id: string;
            /** @default false */
            reorder: boolean;
        };
        EntityChangeOfComponentInstance: {
            after: null | components["schemas"]["ComponentInstance"];
            /** Format: int32 */
            afterIndex: number | string;
            before: null | components["schemas"]["ComponentInstance"];
            /** Format: int32 */
            beforeIndex: number | string;
            /** Format: uuid */
            id: string;
            /** @default false */
            reorder: boolean;
        };
        EntityChangeOfDesignStyle: {
            after: null | components["schemas"]["DesignStyle"];
            /** Format: int32 */
            afterIndex: number | string;
            before: null | components["schemas"]["DesignStyle"];
            /** Format: int32 */
            beforeIndex: number | string;
            /** Format: uuid */
            id: string;
            /** @default false */
            reorder: boolean;
        };
        EntityChangeOfDesignToken: {
            after: null | components["schemas"]["DesignToken"];
            /** Format: int32 */
            afterIndex: number | string;
            before: null | components["schemas"]["DesignToken"];
            /** Format: int32 */
            beforeIndex: number | string;
            /** Format: uuid */
            id: string;
            /** @default false */
            reorder: boolean;
        };
        EntityChangeOfDocumentAsset: {
            after: null | components["schemas"]["DocumentAsset"];
            /** Format: int32 */
            afterIndex: number | string;
            before: null | components["schemas"]["DocumentAsset"];
            /** Format: int32 */
            beforeIndex: number | string;
            /** Format: uuid */
            id: string;
            /** @default false */
            reorder: boolean;
        };
        EntityChangeOfDocumentDataset: {
            after: null | components["schemas"]["DocumentDataset"];
            /** Format: int32 */
            afterIndex: number | string;
            before: null | components["schemas"]["DocumentDataset"];
            /** Format: int32 */
            beforeIndex: number | string;
            /** Format: uuid */
            id: string;
            /** @default false */
            reorder: boolean;
        };
        EntityChangeOfDocumentFontFamily: {
            after: null | components["schemas"]["DocumentFontFamily"];
            /** Format: int32 */
            afterIndex: number | string;
            before: null | components["schemas"]["DocumentFontFamily"];
            /** Format: int32 */
            beforeIndex: number | string;
            /** Format: uuid */
            id: string;
            /** @default false */
            reorder: boolean;
        };
        EntityChangeOfNodeStructure: {
            after: null | components["schemas"]["NodeStructure"];
            /** Format: int32 */
            afterIndex: number | string;
            before: null | components["schemas"]["NodeStructure"];
            /** Format: int32 */
            beforeIndex: number | string;
            /** Format: uuid */
            id: string;
            /** @default false */
            reorder: boolean;
        };
        EntityChangeOfPageStructure: {
            after: null | components["schemas"]["PageStructure"];
            /** Format: int32 */
            afterIndex: number | string;
            before: null | components["schemas"]["PageStructure"];
            /** Format: int32 */
            beforeIndex: number | string;
            /** Format: uuid */
            id: string;
            /** @default false */
            reorder: boolean;
        };
        EntityChangeOfPreviewScenario: {
            after: null | components["schemas"]["PreviewScenario"];
            /** Format: int32 */
            afterIndex: number | string;
            before: null | components["schemas"]["PreviewScenario"];
            /** Format: int32 */
            beforeIndex: number | string;
            /** Format: uuid */
            id: string;
            /** @default false */
            reorder: boolean;
        };
        EntityChangeOfScreenStructure: {
            after: null | components["schemas"]["ScreenStructure"];
            /** Format: int32 */
            afterIndex: number | string;
            before: null | components["schemas"]["ScreenStructure"];
            /** Format: int32 */
            beforeIndex: number | string;
            /** Format: uuid */
            id: string;
            /** @default false */
            reorder: boolean;
        };
        EntityTagHeaderValue: {
            isWeak?: boolean;
            tag?: components["schemas"]["StringSegment"];
        };
        ExpandedRepeaterNode: {
            /** Format: uuid */
            bindingNodeId: null | string;
            childIds: (number | string)[];
            /** Format: int32 */
            id: number | string;
            instancePath: string[];
            kind: string;
            properties: {
                [key: string]: components["schemas"]["NodePropertyValue"];
            };
            /** Format: uuid */
            sourceNodeId: string;
        };
        FileContentResult: {
            contentType?: null | string;
            enableRangeProcessing?: boolean;
            entityTag?: null | components["schemas"]["EntityTagHeaderValue"];
            /** Format: byte */
            fileContents?: string;
            fileDownloadName?: null | string;
            /** Format: date-time */
            lastModified?: null | string;
        };
        HistoryCommandRequest: {
            /** Format: uuid */
            commandId: string;
        };
        ImportDesignTokensRequest: {
            /** Format: uuid */
            commandId: string;
            darkJson: string;
            dimensionCategories?: null | {
                [key: string]: components["schemas"]["TokenCategory"];
            };
            dimensionTypes: {
                [key: string]: components["schemas"]["TokenType"];
            };
            /** Format: int64 */
            expectedRevision: number | string;
            lightJson: string;
            numberCategories?: null | {
                [key: string]: components["schemas"]["TokenCategory"];
            };
        };
        InsertComponentInstanceRequest: {
            /** Format: uuid */
            commandId: string;
            /** Format: uuid */
            definitionId: string;
            /** Format: uuid */
            nodeId: string;
            /** Format: uuid */
            parentId: string;
            /** Format: int32 */
            position: number | string;
        };
        InviteUserRequest: {
            email: string;
        };
        JsonElement: unknown;
        JsonObject: Record<string, never>;
        LayoutBox: {
            bounds: components["schemas"]["LayoutRect"];
            clip: null | components["schemas"]["LayoutRect"];
            /** Format: uuid */
            objectId: string;
        };
        LayoutDiagnostic: {
            code: string;
            message: string;
            /** Format: uuid */
            objectId: string;
            property: string;
        };
        LayoutRect: {
            /** Format: double */
            height?: number | string;
            /** Format: double */
            width?: number | string;
            /** Format: double */
            x?: number | string;
            /** Format: double */
            y?: number | string;
        };
        MoveNodeRequest: {
            /** Format: uuid */
            commandId: string;
            /** Format: uuid */
            expectedParentId: string;
            /** Format: int64 */
            expectedRevision?: null | number | string;
            /** Format: uuid */
            nodeId: string;
            /** Format: int32 */
            position: number | string;
            /** Format: uuid */
            targetParentId: string;
        };
        NameChange: {
            after: string;
            before: string;
        };
        NodeColorValue: unknown;
        NodeDataBinding: {
            binding: components["schemas"]["DataBinding"];
            /** Format: uuid */
            datasetId: string;
        };
        NodeGradientStop: {
            color?: null | components["schemas"]["NodeColorValue"];
            /** Format: double */
            position: number | string;
            /** Format: uuid */
            tokenId?: null | string;
        };
        NodeKindDefinition: {
            canContainChildren: boolean;
            kind: string;
            previewEvents: components["schemas"]["PreviewEvent"][];
            properties: {
                [key: string]: components["schemas"]["NodePropertyDefinition"];
            };
            semanticRole: components["schemas"]["NodeSemanticRole"];
            supportsDemoValue: boolean;
        };
        NodePropertyDefinition: {
            defaultValue?: null | components["schemas"]["NodePropertyValue"];
            enumValues?: null | string[];
            legacyTokenType?: null | components["schemas"]["TokenType"];
            /** Format: double */
            maximum?: null | number | string;
            /** Format: int32 */
            maxLength?: null | number | string;
            /** Format: double */
            minimum?: null | number | string;
            /** @default false */
            numericFontWeight: boolean;
            pattern?: null | string;
            required?: boolean;
            styleType?: null | components["schemas"]["DesignStyleType"];
            tokenCategory?: null | components["schemas"]["TokenCategory"];
            tokenType?: null | components["schemas"]["TokenType"];
            type: components["schemas"]["NodePropertyType"];
        };
        /** @enum {unknown} */
        NodePropertyType: "String" | "Number" | "Boolean" | "Asset" | "TokenReference" | "Enum" | "Color" | "StyleReference" | "Shadow" | "LinearGradient";
        NodePropertyValue: components["schemas"]["NodePropertyValueNodeStringValue"] | components["schemas"]["NodePropertyValueNodeNumberValue"] | components["schemas"]["NodePropertyValueNodeBooleanValue"] | components["schemas"]["NodePropertyValueNodeAssetValue"] | components["schemas"]["NodePropertyValueNodeTokenValue"] | components["schemas"]["NodePropertyValueNodeStyleValue"] | components["schemas"]["NodePropertyValueNodeTypographyValue"] | components["schemas"]["NodePropertyValueNodeEnumValue"] | components["schemas"]["NodePropertyValueNodeColorValue"] | components["schemas"]["NodePropertyValueNodeShadowValue"] | components["schemas"]["NodePropertyValueNodeLinearGradientValue"];
        NodePropertyValueNodeAssetValue: {
            /** Format: uuid */
            assetId: string;
            /** @enum {string} */
            type?: "asset";
        };
        NodePropertyValueNodeBooleanValue: {
            /** @enum {string} */
            type?: "boolean";
            value: boolean;
        };
        NodePropertyValueNodeColorValue: {
            /**
             * Format: uint8
             * @default 255
             */
            alpha: number | string;
            /** Format: uint8 */
            blue: number | string;
            /** Format: uint8 */
            green: number | string;
            /** Format: uint8 */
            red: number | string;
            /** @enum {string} */
            type?: "color";
        };
        NodePropertyValueNodeEnumValue: {
            /** @enum {string} */
            type?: "enum";
            value: string;
        };
        NodePropertyValueNodeLinearGradientValue: {
            /** Format: double */
            angle: number | string;
            stops: components["schemas"]["NodeGradientStop"][];
            /** @enum {string} */
            type?: "linearGradient";
        };
        NodePropertyValueNodeNumberValue: {
            /** @enum {string} */
            type?: "number";
            /** Format: double */
            value: number | string;
        };
        NodePropertyValueNodeShadowValue: {
            /** Format: double */
            blurRadius: number | string;
            color: components["schemas"]["NodeColorValue"];
            /** Format: double */
            offsetX: number | string;
            /** Format: double */
            offsetY: number | string;
            /** Format: double */
            spreadRadius: number | string;
            /** @enum {string} */
            type?: "shadow";
        };
        NodePropertyValueNodeStringValue: {
            /** @enum {string} */
            type?: "string";
            value: string;
        };
        NodePropertyValueNodeStyleValue: {
            /** Format: uuid */
            styleId: string;
            /** @enum {string} */
            type?: "style";
        };
        NodePropertyValueNodeTokenValue: {
            /** Format: uuid */
            tokenId: string;
            /** @enum {string} */
            type?: "token";
        };
        NodePropertyValueNodeTypographyValue: {
            /** @enum {string} */
            type?: "typography";
            value: components["schemas"]["TokenValue"];
        };
        NodeRepeater: {
            bindings: components["schemas"]["RepeaterItemBinding"][];
            /** Format: uuid */
            datasetId: string;
            /** Format: uuid */
            emptyViewNodeId: string;
            items: components["schemas"]["DataBinding"];
            /** Format: uuid */
            templateNodeId: string;
        };
        /** @enum {unknown} */
        NodeSemanticRole: "Container" | "Text" | "Button" | "TextInput" | "Image" | "Ellipse" | "Line" | "Icon";
        NodeStructure: {
            childIds: string[];
            dataBindings: {
                [key: string]: components["schemas"]["NodeDataBinding"];
            };
            /** Format: uuid */
            id: string;
            kind: string;
            name: string;
            properties: {
                [key: string]: components["schemas"]["NodePropertyValue"];
            };
            repeater: null | components["schemas"]["NodeRepeater"];
            semanticKey: null | string;
        };
        PageStructure: {
            /** Format: uuid */
            id: string;
            name?: string;
            screenIds: string[];
        };
        PortableResourceSnapshot: {
            diagnostics: string[];
            /** Format: uuid */
            documentId: string;
            /** Format: int64 */
            revision: number | string;
            styles: components["schemas"]["PortableStyleResource"][];
            tokens: components["schemas"]["PortableTokenResource"][];
        };
        PortableStyleResource: {
            /** Format: uuid */
            basedOnStyleId: null | string;
            effective: {
                [key: string]: {
                    [key: string]: components["schemas"]["NodePropertyValue"];
                };
            };
            fields: {
                [key: string]: components["schemas"]["NodePropertyValue"];
            };
            /** Format: uuid */
            id: string;
            name: string;
            type: components["schemas"]["DesignStyleType"];
        };
        PortableTokenResource: {
            category: null | components["schemas"]["TokenCategory"];
            effective: {
                [key: string]: components["schemas"]["TokenValue"];
            };
            /** Format: uuid */
            id: string;
            name: string;
            references: string[];
            type: components["schemas"]["TokenType"];
        };
        PortableUiProfileReference: {
            id: string;
            /** Format: int32 */
            version: number | string;
        };
        PresenceCursor: {
            /** Format: double */
            x: number | string;
            /** Format: double */
            y: number | string;
        };
        PresenceCursorRequest: {
            /** Format: double */
            x: number | string;
            /** Format: double */
            y: number | string;
        };
        PresenceParticipant: {
            actorId: string;
            color: string;
            cursor: null | components["schemas"]["PresenceCursor"];
            name: string;
            /** Format: uuid */
            screenId: null | string;
            selectedIds: string[];
        };
        PresenceParticipantsResponse: {
            code: string;
            participants: components["schemas"]["PresenceParticipant"][];
        };
        PresenceUpdateRequest: {
            color: string;
            cursor?: null | components["schemas"]["PresenceCursorRequest"];
            name: string;
            /** Format: uuid */
            screenId?: null | string;
            selectedIds: string[];
        };
        PresenceUpdateResponse: {
            code: string;
        };
        PreviewAction: components["schemas"]["PreviewActionNavigate"] | components["schemas"]["PreviewActionShowVariant"] | components["schemas"]["PreviewActionSetDemoValue"] | components["schemas"]["PreviewActionSelectDataset"] | components["schemas"]["PreviewActionOpenOverlay"] | components["schemas"]["PreviewActionCloseOverlay"] | components["schemas"]["PreviewActionResetPreview"];
        PreviewActionCloseOverlay: {
            /** @enum {string} */
            type?: "closeOverlay";
        };
        PreviewActionNavigate: {
            /** Format: uuid */
            screenId: string;
            /** @enum {string} */
            type?: "navigate";
        };
        PreviewActionOpenOverlay: {
            /** Format: uuid */
            screenId: string;
            /** @enum {string} */
            type?: "openOverlay";
        };
        PreviewActionResetPreview: {
            /** @enum {string} */
            type?: "resetPreview";
        };
        PreviewActionSelectDataset: {
            /** Format: uuid */
            datasetId: null | string;
            /** @enum {string} */
            type?: "selectDataset";
        };
        PreviewActionSetDemoValue: {
            /** Format: uuid */
            nodeId: string;
            /** @enum {string} */
            type?: "setDemoValue";
            value: null | string;
        };
        PreviewActionShowVariant: {
            /** @enum {string} */
            type?: "showVariant";
            /** Format: uuid */
            variantId: null | string;
        };
        PreviewEvent: number;
        PreviewPlaybackRequest: {
            /** Format: int64 */
            revision: number | string;
            selection: components["schemas"]["PreviewSelection"];
            triggers: components["schemas"]["PreviewTrigger"][];
        };
        PreviewScenario: {
            actions: components["schemas"]["PreviewAction"][];
            event: components["schemas"]["PreviewEvent"];
            /** Format: uuid */
            id: string;
            /** Format: uuid */
            nodeId: string;
            /** Format: uuid */
            screenId: string;
        };
        PreviewSelection: {
            /** Format: uuid */
            datasetId: null | string;
            /** Format: uuid */
            screenId: string;
            theme: components["schemas"]["TokenTheme"];
            /** Format: uuid */
            variantId: null | string;
            viewport: components["schemas"]["PreviewViewport"];
        };
        PreviewSession: {
            canGoBack?: boolean;
            overlays?: null | string[];
            selection?: components["schemas"]["PreviewSelection"];
            values?: null | {
                [key: string]: string;
            };
        };
        PreviewTrigger: {
            event: components["schemas"]["PreviewEvent"];
            /** Format: uuid */
            nodeId: string;
        };
        PreviewViewport: {
            /** Format: double */
            height: number | string;
            /** Format: double */
            width: number | string;
        };
        ReconnectResponse: {
            code: string;
            events: null | components["schemas"]["CommittedDocumentEvent"][];
            /** Format: int64 */
            revision: number | string;
            snapshot: null | components["schemas"]["DocumentState"];
        };
        RemoveComponentParameterOverrideRequest: {
            /** Format: uuid */
            commandId: string;
            /** Format: uuid */
            nodeId: string;
            /** Format: uuid */
            parameterId: string;
        };
        RemoveComponentVariantParameterChangeRequest: {
            /** Format: uuid */
            commandId: string;
            /** Format: uuid */
            definitionId: string;
            /** Format: uuid */
            parameterId: string;
            /** Format: uuid */
            variantId: string;
        };
        RemoveDatasetConnectorRequest: {
            /** Format: uuid */
            commandId: string;
            /** Format: uuid */
            datasetId: string;
            /** Format: int64 */
            expectedRevision: number | string;
        };
        RemoveNodePropertiesRequest: {
            /** Format: uuid */
            commandId: string;
            /** Format: int64 */
            expectedRevision: number | string;
            /** Format: uuid */
            nodeId: string;
            properties: string[];
        };
        RemoveScreenVariantOverrideRequest: {
            /** Format: uuid */
            commandId: string;
            /** Format: int64 */
            expectedRevision?: null | number | string;
            /** Format: uuid */
            nodeId: string;
            property: string;
            /** Format: uuid */
            screenId: string;
            /** Format: uuid */
            variantId: string;
        };
        RenameDocumentRequest: {
            /** Format: uuid */
            commandId: string;
            name: string;
        };
        RenamePageRequest: {
            /** Format: uuid */
            commandId: string;
            name: string;
            /** Format: uuid */
            pageId: string;
        };
        RenameScreenRequest: {
            /** Format: uuid */
            commandId: string;
            name: string;
            /** Format: uuid */
            screenId: string;
        };
        RenameTokenRequest: {
            /** Format: uuid */
            commandId: string;
            name: string;
            /** Format: uuid */
            tokenId: string;
        };
        RepeaterEvaluationResponse: {
            diagnostic: null | components["schemas"]["DataDiagnostic"];
            /** Format: uuid */
            documentId: string;
            /** Format: uuid */
            emptyViewNodeId: null | string;
            emptyViewNodes?: components["schemas"]["ExpandedRepeaterNode"][];
            items: components["schemas"]["RepeaterPropertyValue"][][];
            /** Format: int32 */
            limit: number | string;
            /** Format: uuid */
            nodeId: string;
            /** Format: int32 */
            offset: number | string;
            /** Format: int64 */
            revision: number | string;
            templateNodes?: components["schemas"]["ExpandedRepeaterNode"][];
            /** Format: int32 */
            total: number | string;
        };
        RepeaterItemBinding: {
            binding: components["schemas"]["DataBinding"];
            /** Format: uuid */
            nodeId: string;
            property: string;
        };
        RepeaterPropertyValue: {
            /** Format: uuid */
            nodeId: string;
            property: string;
            value: components["schemas"]["NodePropertyValue"];
        };
        ReplaceDatasetFixtureFromCsvRequest: {
            /** Format: uuid */
            commandId: string;
            csv: string;
            /** Format: uuid */
            datasetId: string;
            /** Format: int64 */
            expectedRevision: number | string;
        };
        ReplaceDatasetFixtureRequest: {
            /** Format: uuid */
            commandId: string;
            /** Format: uuid */
            datasetId: string;
            /** Format: int64 */
            expectedRevision: number | string;
            fixtureJson: string;
        };
        ResizeScreenRequest: {
            /** Format: uuid */
            commandId: string;
            dimensions: components["schemas"]["ScreenDimensions"];
            /** Format: uuid */
            historyGroupId?: null | string;
            /** Format: uuid */
            screenId: string;
            updateHeight?: boolean;
            updateWidth?: boolean;
        };
        RestoreDocumentRequest: {
            /** Format: uuid */
            commandId: string;
            /** Format: uuid */
            versionId: string;
        };
        RevisionDiffItem: {
            change: string;
            changedProperties: string[];
            /** Format: uuid */
            id: string;
            type: string;
        };
        RevisionDiffResponse: {
            /** Format: uuid */
            documentId: string;
            /** Format: int64 */
            fromRevision: number | string;
            items: components["schemas"]["RevisionDiffItem"][];
            /** Format: int32 */
            limit: number | string;
            /** Format: int32 */
            offset: number | string;
            /** Format: int64 */
            toRevision: number | string;
            /** Format: int32 */
            total: number | string;
        };
        SaveDocumentRequest: {
            /** Format: uuid */
            commandId: string;
            name?: null | string;
        };
        ScenarioCapabilitiesResponse: {
            actions: string[];
            /** Format: uuid */
            datasetId: null | string;
            /** Format: uuid */
            demoNodeId: null | string;
            /** Format: uuid */
            demoScreenId?: null | string;
            demoTargetIds?: string[];
            demoValue: null | string;
            /** Format: uuid */
            documentId: string;
            events: components["schemas"]["PreviewEvent"][];
            /** Format: uuid */
            navigationScreenId?: null | string;
            /** Format: uuid */
            nodeId: string;
            potentialActions?: string[];
            profile: components["schemas"]["PortableUiProfileReference"];
            /** Format: int64 */
            revision: number | string;
            /** Format: uuid */
            screenId: null | string;
            /** Format: uuid */
            targetId: null | string;
            /** Format: uuid */
            variantId: null | string;
        };
        ScenarioCapabilitiesValueRequest: {
            demoValue: null | string;
            prefix?: null | components["schemas"]["PreviewAction"][];
            /** Format: uuid */
            sourceScreenId?: null | string;
        };
        ScenariosResponse: {
            /** Format: uuid */
            documentId: string;
            items: components["schemas"]["PreviewScenario"][];
            /** Format: int32 */
            limit: number | string;
            /** Format: int32 */
            offset: number | string;
            /** Format: int64 */
            revision: number | string;
            /** Format: int32 */
            total: number | string;
        };
        ScreenDimensions: {
            /** Format: double */
            height: number | string;
            /** Format: double */
            width: number | string;
        };
        ScreenLayoutOverride: {
            /** Format: uuid */
            nodeId: string;
            properties: {
                [key: string]: components["schemas"]["NodePropertyValue"];
            };
        };
        ScreenLayoutResponse: {
            /** @description Screen-local bounds and accumulated clipping rectangles in tree order, beginning with the screen itself. */
            boxes: components["schemas"]["LayoutBox"][];
            diagnostics: components["schemas"]["LayoutDiagnostic"][];
            /** Format: uuid */
            documentId: string;
            /** Format: int32 */
            limit: number | string;
            /** Format: int32 */
            offset: number | string;
            overrides?: null | components["schemas"]["ScreenLayoutOverride"][];
            /** Format: int64 */
            revision: number | string;
            /** Format: uuid */
            screenId: string;
            /** Format: int32 */
            total: number | string;
        };
        ScreenPropertyOverride: {
            /** Format: uuid */
            nodeId: string;
            property: string;
            value: components["schemas"]["NodePropertyValue"];
        };
        ScreenStructure: {
            childIds: string[];
            dimensions: components["schemas"]["ScreenDimensions"];
            /** Format: uuid */
            id: string;
            name?: null | string;
            variants: components["schemas"]["ScreenVariant"][];
        };
        ScreenVariant: {
            /** Format: uuid */
            id: string;
            name: string;
            overrides: components["schemas"]["ScreenPropertyOverride"][];
        };
        ScreenVariantDifference: {
            /** Format: uuid */
            nodeId: string;
            property: string;
        };
        ScreenVariantDiffResponse: {
            /** Format: uuid */
            documentId: string;
            /** Format: uuid */
            fromVariantId: null | string;
            items: components["schemas"]["ScreenVariantDifference"][];
            /** Format: int32 */
            limit: number | string;
            /** Format: int32 */
            offset: number | string;
            /** Format: int64 */
            revision: number | string;
            /** Format: uuid */
            screenId: string;
            /** Format: int32 */
            total: number | string;
            /** Format: uuid */
            toVariantId: null | string;
        };
        ScreenVariantsResponse: {
            /** Format: uuid */
            documentId: string;
            items: components["schemas"]["ScreenVariant"][];
            /** Format: int32 */
            limit: number | string;
            /** Format: int32 */
            offset: number | string;
            /** Format: int64 */
            revision: number | string;
            /** Format: uuid */
            screenId: string;
            /** Format: int32 */
            total: number | string;
        };
        SetComponentInstanceVariantRequest: {
            /** Format: uuid */
            commandId: string;
            /** Format: uuid */
            nodeId: string;
            /** Format: uuid */
            variantId: null | string;
        };
        SetComponentParameterDefaultRequest: {
            /** Format: uuid */
            commandId: string;
            /** Format: uuid */
            definitionId: string;
            /** Format: uuid */
            parameterId: string;
            value: components["schemas"]["ComponentValue"];
        };
        SetComponentParameterOverrideRequest: {
            /** Format: uuid */
            commandId: string;
            /** Format: uuid */
            nodeId: string;
            /** Format: uuid */
            parameterId: string;
            value: components["schemas"]["ComponentValue"];
        };
        SetComponentSlotContentRequest: {
            /** Format: uuid */
            commandId: string;
            contentNodeIds: string[];
            /** Format: uuid */
            nodeId: string;
            /** Format: uuid */
            slotId: string;
        };
        SetComponentVariantParameterChangeRequest: {
            /** Format: uuid */
            commandId: string;
            /** Format: uuid */
            definitionId: string;
            /** Format: uuid */
            parameterId: string;
            value: components["schemas"]["ComponentValue"];
            /** Format: uuid */
            variantId: string;
        };
        SetDatasetConnectorRequest: {
            /** Format: uuid */
            commandId: string;
            connectorId: string;
            /** Format: uuid */
            datasetId: string;
            /** Format: int64 */
            expectedRevision: number | string;
        };
        SetDocumentMemberRequest: {
            memberId: string;
            role: string;
        };
        SetNodeNameRequest: {
            /** Format: uuid */
            commandId: string;
            /** Format: uuid */
            historyGroupId?: null | string;
            name: string;
            /** Format: uuid */
            nodeId: string;
        };
        SetNodePropertiesRequest: {
            /** Format: uuid */
            commandId: string;
            /** Format: uuid */
            expectedParentId?: null | string;
            /** Format: int64 */
            expectedRevision?: null | number | string;
            /** Format: uuid */
            historyGroupId?: null | string;
            /** Format: uuid */
            nodeId: string;
            properties: {
                [key: string]: components["schemas"]["NodePropertyValue"];
            };
        };
        SetNodePropertyRequest: {
            /** Format: uuid */
            commandId: string;
            /** Format: uuid */
            nodeId: string;
            property: string;
            value: components["schemas"]["NodePropertyValue"];
        };
        SetNodeRepeaterRequest: {
            /** Format: uuid */
            commandId: string;
            /** Format: int64 */
            expectedRevision: number | string;
            /** Format: uuid */
            nodeId: string;
            repeater: null | components["schemas"]["NodeRepeater"];
        };
        SetNodeSemanticKeyRequest: {
            /** Format: uuid */
            commandId: string;
            /** Format: uuid */
            historyGroupId?: null | string;
            /** Format: uuid */
            nodeId: string;
            semanticKey: null | string;
        };
        SetScreenVariantOverrideRequest: {
            /** Format: uuid */
            commandId: string;
            /** Format: uuid */
            nodeId: string;
            property: string;
            /** Format: uuid */
            screenId: string;
            value: components["schemas"]["NodePropertyValue"];
            /** Format: uuid */
            variantId: string;
        };
        SetScreenVariantPropertiesRequest: {
            /** Format: uuid */
            commandId: string;
            /** Format: int64 */
            expectedRevision: number | string;
            /** Format: uuid */
            historyGroupId?: null | string;
            /** Format: uuid */
            nodeId: string;
            properties: {
                [key: string]: components["schemas"]["NodePropertyValue"];
            };
            /** Format: uuid */
            screenId: string;
            /** Format: uuid */
            variantId: string;
        };
        SetTokenValueRequest: {
            /** Format: uuid */
            commandId: string;
            theme: components["schemas"]["TokenTheme"];
            /** Format: uuid */
            tokenId: string;
            value: components["schemas"]["TokenExpression"];
        };
        StringSegment: {
            buffer?: null | string;
            hasValue?: boolean;
            /** Format: int32 */
            length?: number | string;
            /** Format: int32 */
            offset?: number | string;
            value?: null | string;
        };
        StructureDiagnostic: {
            /** @description Structure validator code: empty-id, duplicate-id, missing-reference, wrong-reference-type, INVALID_NODE_METADATA, unknown-node-kind, children-not-allowed, invalid-properties, UNSUPPORTED_PROPERTY, INVALID_PROPERTY_TYPE, INVALID_PROPERTY_VALUE, node-ownership, or cycle. */
            code: string;
            message: string;
            /** @description ID-based document element path; property names use JSON Pointer escaping. */
            path: string;
            property: null | string;
            /** Format: uuid */
            referenceId: null | string;
        };
        StructureDiagnosticsResponse: {
            /** Format: uuid */
            documentId: string;
            items: components["schemas"]["StructureDiagnostic"][];
            /** Format: int32 */
            limit: number | string;
            /** Format: int32 */
            offset: number | string;
            /** Format: int64 */
            revision: number | string;
            /** Format: uuid */
            screenId: null | string;
            /** Format: int32 */
            total: number | string;
        };
        StructureItem: {
            canContainChildren?: null | boolean;
            /** Format: int32 */
            childCount?: null | number | string;
            children?: null | components["schemas"]["StructureItem"][];
            childrenTruncated?: null | boolean;
            dataBindings?: null | {
                [key: string]: components["schemas"]["NodeDataBinding"];
            };
            dimensions?: null | components["schemas"]["ScreenDimensions"];
            /** Format: uuid */
            id: string;
            kind?: null | string;
            name?: null | string;
            /** Format: uuid */
            parentId?: null | string;
            properties?: null | {
                [key: string]: components["schemas"]["NodePropertyValue"];
            };
            repeater?: null | components["schemas"]["NodeRepeater"];
            resolutionDiagnostics?: null | components["schemas"]["LayoutDiagnostic"][];
            resolvedProperties?: null | {
                [key: string]: components["schemas"]["NodePropertyValue"];
            };
            semanticKey?: null | string;
            type: string;
        };
        StructureResponse: {
            /** Format: uuid */
            documentId: string;
            items: components["schemas"]["StructureItem"][];
            /** Format: int32 */
            limit: number | string;
            /** Format: int32 */
            offset: number | string;
            /** Format: int64 */
            revision: number | string;
            /** Format: int32 */
            total: number | string;
        };
        StyleListResponse: {
            /** Format: uuid */
            documentId: string;
            items: components["schemas"]["DesignStyle"][];
            /** Format: int32 */
            limit: number | string;
            /** Format: int32 */
            offset: number | string;
            /** Format: int64 */
            revision: number | string;
            /** Format: int32 */
            total: number | string;
        };
        StyleUsagesResponse: {
            /** Format: uuid */
            documentId: string;
            items: components["schemas"]["DesignResourceUse"][];
            /** Format: int32 */
            limit: number | string;
            /** Format: int32 */
            offset: number | string;
            /** Format: int64 */
            revision: number | string;
            /** Format: uuid */
            styleId: string;
            /** Format: int32 */
            total: number | string;
        };
        TokenCategory: number;
        TokenExportDiagnostic: {
            code: string;
            message: string;
            /** Format: uuid */
            tokenId: string;
        };
        TokenExportResponse: {
            diagnostics: components["schemas"]["TokenExportDiagnostic"][];
            /** Format: uuid */
            documentId: string;
            /** Format: int64 */
            revision: number | string;
            theme: components["schemas"]["TokenTheme"];
            tokens: null | components["schemas"]["JsonObject"];
        };
        TokenExpression: components["schemas"]["TokenExpressionLiteralTokenValue"] | components["schemas"]["TokenExpressionTokenAlias"];
        TokenExpressionLiteralTokenValue: {
            /** @enum {string} */
            expression?: "literal";
            value: components["schemas"]["TokenValue"];
        };
        TokenExpressionTokenAlias: {
            /** @enum {string} */
            expression?: "alias";
            /** Format: uuid */
            tokenId: string;
        };
        TokenImportDiagnostic: {
            code: string;
            message: string;
            path: string;
        };
        TokenListResponse: {
            /** Format: uuid */
            documentId: string;
            items: components["schemas"]["DesignToken"][];
            /** Format: int32 */
            limit: number | string;
            /** Format: int32 */
            offset: number | string;
            /** Format: int64 */
            revision: number | string;
            /** Format: int32 */
            total: number | string;
        };
        TokenResponse: {
            /** Format: uuid */
            documentId: string;
            /** Format: int64 */
            revision: number | string;
            token: components["schemas"]["DesignToken"];
        };
        TokenTheme: number;
        TokenType: number;
        TokenUsage: {
            chain?: null | string[];
            /** @default false */
            indirect: boolean;
            kind: string;
            label?: null | string;
            /** Format: uuid */
            ownerId: string;
            /** Format: uuid */
            parameterId: null | string;
            property: null | string;
            theme: null | components["schemas"]["TokenTheme"];
        };
        TokenUsagesResponse: {
            /** Format: uuid */
            documentId: string;
            items: components["schemas"]["TokenUsage"][];
            /** Format: int32 */
            limit: number | string;
            /** Format: int32 */
            offset: number | string;
            /** Format: int64 */
            revision: number | string;
            /** Format: uuid */
            tokenId: string;
            /** Format: int32 */
            total: number | string;
        };
        TokenValue: components["schemas"]["TokenValueColorValue"] | components["schemas"]["TokenValueSpacingValue"] | components["schemas"]["TokenValueTypographyValue"] | components["schemas"]["TokenValueTypographyFieldsValue"] | components["schemas"]["TokenValueGeometryValue"] | components["schemas"]["TokenValueDimensionValue"] | components["schemas"]["TokenValueNumberValue"] | components["schemas"]["TokenValueFontFamilyValue"] | components["schemas"]["TokenValueFontWeightValue"] | components["schemas"]["TokenValueShadowValue"] | components["schemas"]["TokenValueShadowFieldsValue"];
        TokenValueColorValue: {
            /**
             * Format: uint8
             * @default 255
             */
            alpha: number | string;
            /** Format: uint8 */
            blue: number | string;
            /** Format: uint8 */
            green: number | string;
            /** Format: uint8 */
            red: number | string;
            /** @enum {string} */
            type?: "color";
        };
        TokenValueDimensionValue: {
            /** @enum {string} */
            type?: "dimension";
            /** Format: double */
            value: number | string;
        };
        TokenValueFontFamilyValue: {
            /** @enum {string} */
            type?: "fontFamily";
            value: string;
        };
        TokenValueFontWeightValue: {
            /** @enum {string} */
            type?: "fontWeight";
            /** Format: int32 */
            value: number | string;
        };
        TokenValueGeometryValue: {
            /** Format: double */
            radius: number | string;
            /** @enum {string} */
            type?: "geometry";
        };
        TokenValueNumberValue: {
            /** @enum {string} */
            type?: "number";
            /** Format: double */
            value: number | string;
        };
        TokenValueShadowFieldsValue: {
            /** Format: double */
            blurRadius: number | string;
            color: components["schemas"]["TokenExpression"];
            /** Format: double */
            offsetX: number | string;
            /** Format: double */
            offsetY: number | string;
            /** Format: double */
            spreadRadius: number | string;
            /** @enum {string} */
            type?: "shadowFields";
        };
        TokenValueShadowValue: {
            /** Format: double */
            blurRadius: number | string;
            color: components["schemas"]["NodeColorValue"];
            /** Format: double */
            offsetX: number | string;
            /** Format: double */
            offsetY: number | string;
            /** Format: double */
            spreadRadius: number | string;
            /** @enum {string} */
            type?: "shadow";
        };
        TokenValueSpacingValue: {
            /** @enum {string} */
            type?: "spacing";
            /** Format: double */
            value: number | string;
        };
        TokenValueTypographyFieldsValue: {
            fontFamily: components["schemas"]["TokenExpression"];
            fontSize: components["schemas"]["TokenExpression"];
            fontWeight: components["schemas"]["TokenExpression"];
            letterSpacing?: null | components["schemas"]["TokenExpression"];
            lineHeight: components["schemas"]["TokenExpression"];
            /** @enum {string} */
            type?: "typographyFields";
        };
        TokenValueTypographyValue: {
            fontFamily: string;
            /** Format: double */
            fontSize: number | string;
            /** Format: int32 */
            fontWeight: number | string;
            /**
             * Format: double
             * @default 0
             */
            letterSpacing: number | string;
            /** Format: double */
            lineHeight: number | string;
            /** @enum {string} */
            type?: "typography";
        };
        UnbindNodeDataRequest: {
            /** Format: uuid */
            commandId: string;
            /** Format: uuid */
            nodeId: string;
            property: string;
        };
        UpdateScenarioRequest: {
            /** Format: uuid */
            commandId: string;
            /** Format: int64 */
            expectedRevision: number | string;
            scenario: components["schemas"]["PreviewScenario"];
        };
        UpdateUserRequest: {
            admin: boolean;
            enabled: boolean;
        };
        UpsertStyleRequest: {
            /** Format: uuid */
            commandId: string;
            /** Format: int64 */
            expectedRevision: number | string;
            style: components["schemas"]["DesignStyle"];
        };
        VersionHistoryResponse: {
            /** Format: int64 */
            nextBeforeRevision: null | number | string;
            versions: components["schemas"]["VersionMetadataResponse"][];
        };
        VersionMetadataResponse: {
            authorId: string;
            /** Format: uuid */
            id: string;
            name: null | string;
            /** Format: int64 */
            revision: number | string;
            /** Format: date-time */
            timestamp: string;
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export type operations = Record<string, never>;
