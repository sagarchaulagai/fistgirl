var msBatchVideoParser = (function()
{
    function MsBatchVideoParser()
    {
    }

    MsBatchVideoParser.prototype = {

        parse: function (obj)
        {
            var url = String(obj.url);
            console.log("FDM Plugin: Starting parse for URL: " + url);
            
            return downloadUrlAsUtf8Text(obj.url, obj.cookies || "", [{ key: "X-Requested-With", value: "JSONHttpRequest" }], "")
                .then(this.parseContent.bind(this, url));
        },

        parseContent: function (originalUrl, response)
        {
            var self = this;
            return new Promise(function(resolve, reject)
            {
                try
                {
                    var json;
                    try {
                        json = JSON.parse(response.body);
                    } catch (e) {
                        console.log("FDM Plugin: Failed to parse JSON: " + e);
                        reject({ error: "Invalid JSON from server", isParseError: false });
                        return;
                    }

                    var parts = self.splitUrl(originalUrl);
                    if (!parts.pasteId || !parts.key) {
                        console.log("FDM Plugin: Invalid URL - missing pasteId or key");
                        reject({ error: "Invalid FitGirl paste URL (missing id or key).", isParseError: true });
                        return;
                    }

                    console.log("FDM Plugin: Starting decryption process...");
                    self.decryptPaste(json, parts.key)
                        .then(function (plaintext) {
                            // Safety check for response size
                            if (plaintext.length > 1000000) { // 1MB limit
                                console.log("FDM Plugin: Warning - Large response detected (" + plaintext.length + " chars), truncating");
                            }
                            var regex = /https?:\/\/fuckingfast\.co\/[^\s"']+/g;
                            var matches = plaintext.match(regex);
                            console.log("FDM Plugin: Found " + (matches ? matches.length : 0) + " potential links");

                            if (matches && matches.length > 0) {
                                var entries = [];
                                var validLinkCount = 0;

                                // Process links synchronously - no need to extract direct links here
                                // The individual msParser will handle the direct link extraction
                                for (var i = 0; i < matches.length && validLinkCount < 200; i++) {
                                    var link = matches[i];
                                    console.log("FDM Plugin: Processing link " + (i + 1) + "/" + matches.length + ": " + link.substring(0, 50) + "...");

                                    if (self.isValidUrl(link)) {
                                        var title = self.getFileNameFromUrl(link);
                                        if (!title || title.length === 0) {
                                            title = "download_" + (validLinkCount + 1);
                                        }

                                        // Return the fuckingfast.co URL directly - msParser will handle the direct link extraction
                                        var entry = {
                                            _type: "url",
                                            url: link,  // This is the fuckingfast.co URL, not the direct download
                                            title: title
                                        };

                                        entries.push(entry);
                                        validLinkCount++;
                                        console.log("FDM Plugin: Added entry for: " + title);
                                    } else {
                                        console.log("FDM Plugin: Skipping invalid URL: " + link);
                                    }
                                }

                                console.log("FDM Plugin: Finished processing all links, found " + entries.length + " valid entries");
                                
                                if (entries.length > 0) {
                                    // Extract game title from first valid link
                                    var gameTitle = self.extractGameTitle(matches[0]) || "FitGirl Download";
                                    
                                    var playlist = {
                                        _type: "playlist",
                                        title: gameTitle,
                                        webpage_url: originalUrl,
                                        entries: entries,
                                        id: "fitgirl-" + Date.now()
                                    };
                                    resolve(playlist);
                                } else {
                                    reject({ error: "No valid links found after filtering.", isParseError: true });
                                }
                            } else {
                                reject({ error: "No links found in decrypted paste.", isParseError: true });
                            }
                        })
                        .catch(function (e) {
                            console.log("FDM Plugin: Decryption failed: " + e);
                            reject({ error: "Failed to decrypt paste via API: " + e, isParseError: false });
                        });
                }
                catch (e)
                {
                    reject({error: e.message, isParseError: true});
                }
            });
        },

        isSupportedSource: function(url)
        {
            return /^https:\/\/paste\.fitgirl-repacks\.site\/\?/.test(url);
        },

        supportedSourceCheckPriority: function()
        {
            return 0x7FFFFFFF;
        },

        isPossiblySupportedSource: function(obj)
        {
            return false;
        },

        minIntevalBetweenQueryInfoDownloads: function()
        {
            return 300;
        },

        // Helper methods
        splitUrl: function (url) {
            console.log("FDM Plugin: splitUrl called with: " + url);
            var pasteId = null, key = null;
            try {
                var hashIndex = url.indexOf("#");
                if (hashIndex !== -1) {
                    key = url.substring(hashIndex + 1);
                    console.log("FDM Plugin: Found key in hash: " + key.substring(0, 10) + "...");
                }
                var m1 = url.match(/[?&]pasteid=([a-f0-9]+)/);
                var m2 = url.match(/[?&]([a-f0-9]{16,32})/);
                if (m1) {
                    pasteId = m1[1];
                    console.log("FDM Plugin: Found pasteId via pasteid param: " + pasteId);
                } else if (m2) {
                    pasteId = m2[1];
                    console.log("FDM Plugin: Found pasteId via direct param: " + pasteId);
                }
            } catch (e) {
                console.log("FDM Plugin: Error in splitUrl: " + e);
            }
            console.log("FDM Plugin: splitUrl result - pasteId: " + pasteId + ", key: " + (key ? "[present]" : "[missing]"));
            return { pasteId: pasteId, key: key };
        },

        decryptPaste: function (json, key) {
            var apiUrl = "https://privatebin-decrypt-api.vercel.app/api/decrypt";

            return new Promise(function (resolve, reject) {
                // Extract the required data from the json response
                var data = json.adata && json.adata[0] ? json.adata[0] : null;
                var cipherMessage = json.ct || "";
                
                if (!data || !cipherMessage) {
                    reject("Invalid paste data structure");
                    return;
                }

                // Prepare payload in the format expected by Vercel API
                var payload = JSON.stringify({
                    key: key,
                    data: [data, "markdown", 0, 0],
                    cipherMessage: cipherMessage
                });

                console.log("FDM Plugin: Calling Vercel decryption API...");
                downloadUrlAsUtf8Text(apiUrl, "", [
                    { key: "Content-Type", value: "application/json" }
                ], payload)
                    .then(function (response) {
                        try {
                            if (!response || !response.body) {
                                reject("Empty response from decryption API");
                                return;
                            }

                            console.log("FDM Plugin: Decryption API response length: " + response.body.length);
                            var respJson = JSON.parse(response.body);
                            
                            if (respJson.success && respJson.decryptedText) {
                                console.log("FDM Plugin: Successfully decrypted content");
                                resolve(respJson.decryptedText);
                            } else if (respJson.error) {
                                reject("API error: " + respJson.error);
                            } else {
                                reject("API did not return decrypted text or success flag");
                            }
                        } catch (e) {
                            console.log("FDM Plugin: Failed to parse API response: " + e);
                            reject("Failed to parse API response: " + e);
                        }
                    })
                    .catch(function (err) {
                        console.log("FDM Plugin: Error calling decryption API: " + err);
                        reject("Error calling decryption API: " + err);
                    });
            });
        },

        extractFuckingFastDirectLink: function (fuckingFastUrl) {
            console.log("FDM Plugin: extractFuckingFastDirectLink called with: " + fuckingFastUrl);

            return new Promise(function (resolve, reject) {
                downloadUrlAsUtf8Text(fuckingFastUrl, "", [], "")
                    .then(function (response) {
                        console.log("FDM Plugin: Received response from fuckingfast.co");

                        if (!response || !response.body) {
                            reject("Empty response from fuckingfast.co");
                            return;
                        }

                        try {
                            var directLinkRegex = /window\.open\("(https:\/\/fuckingfast\.co\/dl\/[^"]+)"/;
                            var match = response.body.match(directLinkRegex);

                            if (match && match[1]) {
                                var directLink = match[1];
                                console.log("FDM Plugin: Found direct download link: " + directLink);
                                resolve(directLink);
                            } else {
                                console.log("FDM Plugin: Could not find direct download link in JavaScript");
                                reject("Could not extract direct download link from fuckingfast.co page");
                            }
                        } catch (e) {
                            console.log("FDM Plugin: Error parsing fuckingfast.co response: " + e);
                            reject("Error parsing fuckingfast.co response: " + e);
                        }
                    })
                    .catch(function (err) {
                        console.log("FDM Plugin: Failed to fetch fuckingfast.co page: " + err);
                        reject("Failed to fetch fuckingfast.co page: " + err);
                    });
            });
        },

        isValidUrl: function (url) {
            try {
                if (!url || typeof url !== 'string' || url.length === 0) {
                    return false;
                }

                if (!url.match(/^https?:\/\//)) {
                    return false;
                }

                if (!url.match(/^https?:\/\/[^\s\/$.?#].[^\s]*$/)) {
                    return false;
                }

                if (!url.match(/\/fuckingfast\.co\//) || url.match(/\/fuckingfast\.co\/dl\//)) {
                    return false;
                }

                return true;
            } catch (e) {
                console.log("FDM Plugin: URL validation error: " + e);
                return false;
            }
        },

        extractGameTitle: function (url) {
            try {
                if (!url || typeof url !== 'string') {
                    return "FitGirl Download";
                }

                // Extract from hash part (filename after #)
                var hashIndex = url.indexOf('#');
                if (hashIndex !== -1) {
                    var filename = url.substring(hashIndex + 1);
                    
                    // Remove the fitgirl-repacks.site part and file extensions
                    filename = filename.replace(/_--_fitgirl-repacks\.site_--_.*$/, '');
                    
                    // Replace underscores with spaces and clean up
                    var gameTitle = filename.replace(/_/g, ' ');
                    
                    // Remove common patterns like version numbers, part numbers
                    gameTitle = gameTitle.replace(/\s+v?\d+(\.\d+)*\s*$/i, ''); // Remove version numbers
                    gameTitle = gameTitle.replace(/\s+part\d+.*$/i, ''); // Remove part numbers
                    gameTitle = gameTitle.replace(/\s+\d+\s*$/, ''); // Remove trailing numbers
                    
                    // Trim and capitalize first letter of each word
                    gameTitle = gameTitle.trim();
                    if (gameTitle.length > 0) {
                        gameTitle = gameTitle.replace(/\b\w/g, function(l) { return l.toUpperCase(); });
                        return gameTitle;
                    }
                }

                return "FitGirl Download";
            } catch (e) {
                console.log("FDM Plugin: Error in extractGameTitle: " + e);
                return "FitGirl Download";
            }
        },

        getFileNameFromUrl: function (url) {
            try {
                if (!url || typeof url !== 'string') {
                    return "download";
                }

                var filename = "download";
                var hashIndex = url.indexOf('#');
                if (hashIndex !== -1) {
                    filename = url.substring(hashIndex + 1);
                } else {
                    filename = "download";
                }

                try {
                    filename = decodeURIComponent(filename);
                } catch (decodeError) {
                    // Use as-is if decode fails
                }

                filename = filename.replace(/[<>:"\/\\|?*]/g, '_');

                if (!filename || filename.length === 0) {
                    filename = "download";
                } else if (filename.length > 255) {
                    filename = filename.substring(0, 255);
                }

                return filename;
            } catch (e) {
                console.log("FDM Plugin: Error in getFileNameFromUrl: " + e);
                return "download";
            }
        }
    };

    return new MsBatchVideoParser();
}());

// Export the parser
msBatchVideoParser = msBatchVideoParser;