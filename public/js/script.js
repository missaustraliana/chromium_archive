function bytesToMB(bytes) {
    return (bytes / (1024 * 1024)).toFixed(2);
}
const DateTime = luxon.DateTime;
fetch("api/index", {

    headers: {
        "Content-Type": "application/x-www-form-urlencoded"
    },
    method: "GET"
}).then(response => {
    response.json().then(data => {
        var container = document.createElement('div');
        container.id = "container";
        for (let i = 0; i < data.availableBuildIndex.length; i++) {

            var chromiumversion = document.createElement('a');
            var br = document.createElement('br');
            chromiumversion.innerHTML = data.availableBuildIndex[i].chromium_version + " <span class=\"thin\">(" + data.availableBuildIndex[i].available_build_count + " builds)</span>"
            chromiumversion.href = "#";
            chromiumversion.setAttribute("onClick", "getVersionListing(\"" + data.availableBuildIndex[i].chromium_version + "\")")
            container.appendChild(chromiumversion);
            container.appendChild(br);
        }
        /*
        var chromiumversion = document.createElement('a');
        var br = document.createElement('br');
        chromiumversion.innerHTML = "<span class=\"thin\">Showing " + data.availableBuilds + " builds.</span>"

        document.body.appendChild(chromiumversion);
        document.body.appendChild(br);
        */
        document.body.appendChild(container);
        console.log(data.availableBuildIndex[1].chromium_version)
        document.getElementById("name").innerHTML = "Chromium Archive"
        document.getElementById("progress").hidden = true

    }
    ).catch((error) => {
        console.error(error)
        document.getElementById("progress").hidden = true
        document.getElementById("name").innerHTML = "Something went wrong."
    }
    )
}
)
function getVersionListing(version) {
    document.getElementById("container").remove();
    document.getElementById("name").innerHTML = "Downloading index."
    document.getElementById("progress").hidden = false
    fetch("api/index/" + version, {

        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        },
        method: "GET"
    }).then(response => {
        response.json().then(data => {
            var container = document.createElement('div');
            container.id = "container";
            for (let i = 0; i < data.buildIndex.length; i++) {

                var chromiumversion = document.createElement('a');
                var br = document.createElement('br');
                const iso = luxon.DateTime.fromISO(data.buildIndex[i].build_date);
                chromiumversion.innerHTML = data.buildIndex[i].build + " <span class=\"thin\">" + iso.toRelative() + "</span>"
                chromiumversion.href = "#";
                chromiumversion.setAttribute("onClick", "getBuildDetails(\"" + version + "\", \"" + data.buildIndex[i].build + "\")")
                container.appendChild(chromiumversion);
                container.appendChild(br);
            }
            document.body.appendChild(container);
            document.getElementById("name").innerHTML = "Chromium " + version
            document.getElementById("progress").hidden = true

        }
        ).catch((error) => {
            console.error(error)
            document.getElementById("progress").hidden = true
            document.getElementById("name").innerHTML = "Something went wrong."
        }
        )
    }
    )
}
function getBuildDetails(version, build) {
    document.getElementById("container").remove();
    document.getElementById("name").innerHTML = "Downloading index."
    document.getElementById("progress").hidden = false
    fetch("api/index/" + version + "/" + build, {

        headers: {
            "Content-Type": "application/x-www-form-urlencoded"
        },
        method: "GET"
    }).then(response => {
        response.json().then(data => {
            var container = document.createElement('div');
            container.id = "container";
            var chromium_version = document.createElement('h2');
            var downloadlink = document.createElement('a');
            var shasum = document.createElement('p');
            var creation = document.createElement('p');
            var itemfilesize = document.createElement('p');
            downloadlink.innerText = "Download"; 
            itemfilesize.innerText = filesize(144539398, {base: 2})
            downloadlink.href = "https://archive.org/download/chromium-macos-arm-archive/" + data[0].filename
            chromium_version.innerText = "Chromium " + data[0].chromium_version
            const iso = luxon.DateTime.fromISO(data[0].build_date);
            creation.innerText = "Published " + iso.toRelative()
            shasum.innerText = data[0].sha1
        
            container.appendChild(chromium_version);
            container.appendChild(creation);
            container.appendChild(downloadlink);
            container.appendChild(itemfilesize);
            container.appendChild(shasum);
            
            /*
                var chromiumversion = document.createElement('a');
                var br = document.createElement('br');
                chromiumversion.innerHTML = data.buildIndex[i].build
                chromiumversion.href = "#";
                chromiumversion.setAttribute("onClick", "getBuildDetails(\"" + version + "\", \"" + data.buildIndex[i].build + "\")")
                container.appendChild(chromiumversion);
                container.appendChild(br);
            */
           console.log(data)
            document.body.appendChild(container);
            document.getElementById("name").innerHTML = "Build " + build
            document.getElementById("progress").hidden = true

        }
        ).catch((error) => {
            console.error(error)
            document.getElementById("progress").hidden = true
            document.getElementById("name").innerHTML = "Something went wrong."
        }
        )
    }
    )
}