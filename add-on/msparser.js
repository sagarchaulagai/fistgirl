var msParser = (function()
{
    function MsParser()
    {
    }

    MsParser.prototype = {
        
        parse: function (obj)
        {
            var url = String(obj.url);
            console.log("FDM msParser: Starting parse for URL: " + url);
            
            var self = this;
            return new Promise(function(resolve, reject)
            {
                try
                {
                    // Extract direct download link from fuckingfast.co URL
                    self.extractFuckingFastDirectLink(url)
                        .then(function (directLink) {
                            console.log("FDM msParser: Successfully extracted direct link: " + directLink.substring(0, 50) + "...");

                            var title = self.getFileNameFromUrl(url);
                            if (!title || title.length === 0) {
                                title = "download";
                            }

                            // Always extract extension for FDM, but handle filename carefully
                            var fileExtension = self.getFileExtension(url) || 'bin';
                            var hasExtension = title.match(/\.[a-zA-Z0-9]{1,10}$/);
                            
                            // If title already has extension, remove it to prevent duplication
                            // FDM will add the extension from the ext field
                            var cleanTitle = title;
                            if (hasExtension && fileExtension) {
                                // Remove the extension from title since FDM will add it from ext field
                                cleanTitle = title.replace(/\.[a-zA-Z0-9]{1,10}$/, '');
                            }
                            
                            console.log("FDM msParser: Original title: " + title + ", clean title: " + cleanTitle + ", ext: " + fileExtension);
                            
                            // Return single media format - always include ext field for FDM
                            var formatObj = {
                                url: directLink,
                                protocol: directLink.startsWith('https://') ? 'https' : 'http',
                                ext: fileExtension,
                                format_id: 'direct_download'
                            };
                            
                            var result = {
                                title: cleanTitle,
                                webpage_url: url,
                                formats: [formatObj]
                            };

                            resolve(result);
                        })
                        .catch(function (error) {
                            console.log("FDM msParser: Failed to extract direct link: " + error);
                            reject({ error: "Failed to extract direct download link: " + error, isParseError: true });
                        });
                }
                catch (e)
                {
                    console.log("FDM msParser: Parse error: " + e.message);
                    reject({error: e.message, isParseError: true});
                }
            });
        },

        isSupportedSource: function(url)
        {
            // Support fuckingfast.co URLs (but not direct download URLs to prevent recursion)
            return /^https:\/\/fuckingfast\.co\/[^\/]+$/.test(url) && !/\/dl\//.test(url);
        },

        supportedSourceCheckPriority: function()
        {
            return 0x7FFFFFFF - 1; // Slightly lower priority than playlist parser
        },

        isPossiblySupportedSource: function(obj)
        {
            return false;
        },

        minIntevalBetweenQueryInfoDownloads: function()
        {
            return 500; // 500ms between individual downloads
        },

        // Helper methods
        extractFuckingFastDirectLink: function (fuckingFastUrl) {
            console.log("FDM msParser: extractFuckingFastDirectLink called with: " + fuckingFastUrl);

            return new Promise(function (resolve, reject) {
                downloadUrlAsUtf8Text(fuckingFastUrl, "", [], "")
                    .then(function (response) {
                        console.log("FDM msParser: Received response from fuckingfast.co");

                        if (!response || !response.body) {
                            reject("Empty response from fuckingfast.co");
                            return;
                        }

                        try {
                            var directLinkRegex = /window\.open\("(https:\/\/fuckingfast\.co\/dl\/[^"]+)"/;
                            var match = response.body.match(directLinkRegex);

                            if (match && match[1]) {
                                var directLink = match[1];
                                console.log("FDM msParser: Found direct download link: " + directLink);
                                resolve(directLink);
                            } else {
                                console.log("FDM msParser: Could not find direct download link in JavaScript");
                                reject("Could not extract direct download link from fuckingfast.co page");
                            }
                        } catch (e) {
                            console.log("FDM msParser: Error parsing fuckingfast.co response: " + e);
                            reject("Error parsing fuckingfast.co response: " + e);
                        }
                    })
                    .catch(function (err) {
                        console.log("FDM msParser: Failed to fetch fuckingfast.co page: " + err);
                        reject("Failed to fetch fuckingfast.co page: " + err);
                    });
            });
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
                    // Try to extract from URL path
                    var pathMatch = url.match(/\/([^\/\?#]+)(?:\?|#|$)/);
                    if (pathMatch && pathMatch[1]) {
                        filename = pathMatch[1];
                    }
                }

                try {
                    filename = decodeURIComponent(filename);
                } catch (decodeError) {
                    // Use as-is if decode fails
                }

                // Clean filename
                filename = filename.replace(/[<>:"\/\\|?*]/g, '_');

                // Log the extracted filename for debugging
                console.log("FDM msParser: Extracted filename: " + filename);

                if (!filename || filename.length === 0) {
                    filename = "download";
                } else if (filename.length > 255) {
                    filename = filename.substring(0, 255);
                }

                return filename;
            } catch (e) {
                console.log("FDM msParser: Error in getFileNameFromUrl: " + e);
                return "download";
            }
        },

        getFileExtension: function (url) {
            try {
                if (!url || typeof url !== 'string') {
                    return null;
                }

                // Extract from hash part (filename after #)
                var hashIndex = url.indexOf('#');
                if (hashIndex !== -1) {
                    var filename = url.substring(hashIndex + 1);
                    
                    // Handle multi-part files properly - look for the actual file extension
                    // e.g., "file.part1.rar" should return "rar", not "part1"
                    var extensionMatch = filename.match(/\.([a-zA-Z0-9]{1,10})$/);
                    if (extensionMatch) {
                        var ext = extensionMatch[1].toLowerCase();
                        console.log("FDM msParser: Detected file extension: " + ext + " from filename: " + filename);
                        return ext;
                    }
                    
                    // Fallback: look for any extension pattern
                    var fallbackMatch = filename.match(/\.([a-zA-Z0-9]{1,10})(?:\.|$)/);
                    if (fallbackMatch) {
                        return fallbackMatch[1].toLowerCase();
                    }
                }

                // Fallback: try to extract from URL path
                var match = url.match(/\.([a-zA-Z0-9]{1,10})(?:\?|#|$)/);
                return match ? match[1].toLowerCase() : null;
            } catch (e) {
                console.log("FDM msParser: Error getting file extension: " + e);
                return null;
            }
        }
    };

    return new MsParser();
}());

// Export the parser
msParser = msParser;
