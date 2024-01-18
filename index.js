const core = require("@actions/core");
const github = require("@actions/github");
const artifact = require("@actions/artifact");
const AdmZip = require("adm-zip");
const pathpkg = require("path");
const tar = require("tar");
const fs = require("fs");
const child_process = require("child_process");
//const https = require("https");

function getXYZversion (s) {
  return s.split(".").map(function(e) { return parseInt(e) });
}

function compareVersions (a, b) {
  for (var i = 0; i < Math.max(a.length, b.length); i ++) {
    if (! a[i]) return -1;
    if (! b[i]) return 1;
    if (a[i] > b[i]) return 1;
    else if (a[i] < b[i]) return -1;
  }
  return 0;
}

async function main() {
  try {
    // inputs
    const version = core.getInput("version");
    const os = core.getInput("os");
    const token = core.getInput("github_token");
    const extract_path = core.getInput("path");
    const debug = core.getInput("debug");
    console.log("Downloading BSC:");
    console.log(`  version: ${version}`);
    console.log(`  OS: ${os}`);
    console.log(`  path: ${extract_path}`);
    console.log(`  debug: ${debug}`);
    console.log("");

    // Config (General)
    const owner = "B-Lang-org";
    const repo = "bsc";
    const install_name = `bsc`;

    // Config (for getting the latest CI build)
    const workflow = "ci.yml";
    const artifact_regex = new RegExp(`^${os} ghc-([0-9]+\.[0-9]\.[0-9]+) build$`);
    const tar_name = `inst`;

    // Turn on extra debug prints
    const debug_extra = false;

    // Create a client using the access token
    const client = github.getOctokit(token);

    // If the extract path doesn't exist, create it
    fs.mkdirSync(extract_path, { recursive: true });

    if (version != "latest") {
      // Expected name of the release asset to download
      const asset_name = `bsc-${version}-${os}.tar.gz`;

      let assets = undefined;
      for await (const releases of client.paginate.iterator(client.rest.repos.listReleases, {
	owner: owner,
	repo: repo,
      }))
      {
	for (const release of releases.data) {
	  if (debug && debug_extra) {
	    console.log(`Release "${release.name}" ${release.id}`);
	    for (const k of Object.getOwnPropertyNames(release))
              console.log(`  ${k}: ${release[k]}`);
	  }
	  if (release.tag_name == version) {
	    assets = release.assets;
	    break;
	  }
	}
	if (assets) break;
      }
      if (! assets) {
	throw new Error("Could not find release");
      }

      let asset_url = undefined;
      for (const asset of assets) {
	if (debug && debug_extra) {
	  console.log("Asset:");
	  for (const k of Object.getOwnPropertyNames(asset))
            console.log(`  ${k}: ${asset[k]}`);
	}
	if (asset.name == asset_name) {
	  asset_url = asset.browser_download_url;
	  break;
	}
      }
      if (! asset_url) {
	console.log("Found the following release assets:");
	for (const asset of assets) {
	  console.log(`  ${asset.name}`);
	}
	throw new Error(`Could not find release asset: ${asset_name}`);
      } else {
	if (debug)
	  console.log(`Found asset URL: ${asset_url}`);
      }

      /*
      const targzfilename = pathpkg.join(extract_path, asset_name);
      const file = fs.createWriteStream(targzfilename);
      https.get(asset_url, response => {
	response.pipe(file);

	file.on("end", () => {
	  file.close();
	  if (debug)
	    console.log(`Asset downloaded: ${targzfilename}`);
	});
      }).on("finish", err => {
	fs.unlink(filename);
	throw err;
      });
      */

      const targzfilename = pathpkg.join(extract_path, asset_name);
      const curl_args = ["--silent", "--location", "--retry", "3", "--fail",
			 "--header", `Authorization: Bearer ${token}`,
			 asset_url, "--output", targzfilename];
      child_process.execFileSync("curl", curl_args);

      await tar.extract({
	file: targzfilename,
	C: extract_path
      });
      if (debug)
	console.log(`Extracted ${targzfilename}`);

      // Rename the directory to "bsc"
      const olddir = pathpkg.join(extract_path, `bsc-${version}-${os}`);
      const newdir = pathpkg.join(extract_path, install_name);
      fs.renameSync(olddir, newdir);

      // Remove the temporary files
      fs.unlinkSync(targzfilename);

    } else {

      // Get the run ID of the latest successful push to main

      for await (const runs of client.paginate.iterator(client.rest.actions.listWorkflowRuns, {
	owner: owner,
	repo: repo,
	workflow_id: workflow,
	event: "push",
	branch: "main",
	status: "success",
	per_page: 1,
	page: 1,
      }))
      {
	for (const run of runs.data) {
	  run_id = run.id;
	  break;
	}
	break;
      }

      if (! run_id) {
	throw new Error("Could not find a successful run");
      } else {
	if (debug)
	  console.log(`Found run ID: ${run_id}`);
      }

      // Get the artifacts
      let artifacts = await client.paginate(client.rest.actions.listWorkflowRunArtifacts, {
	owner: owner,
	repo: repo,
	run_id: run_id,
      });
      if ((! artifacts) || (artifacts.length == 0)) {
	throw new Error("Could not find artifacts");
      }

      // Find the artifact with a specific name
      let artifact_id = undefined;
      var ghc_version;
      for (const artifact of artifacts) {
	var match_res = artifact_regex.exec(artifact.name);
	if (match_res != null) {
	  if (! artifact_id) {
	    // first match, so take it
	    artifact_id = artifact.id;
	    ghc_version = getXYZversion(match_res[1]);
	  } else {
	    var new_ghc_ver = getXYZversion(match_res[1]);
	    if (compareVersions(new_ghc_ver, ghc_version) < 0) {
	      // The new artifact has lower GHC version, so take it
	      artifact_id = artifact.id;
	      ghc_version = new_ghc_ver;
	    }
	  }
	}
      }
      if (! artifact_id) {
	console.log("Found the following artifacts:");
	for (const artifact of artifacts) {
	  console.log(`  ${artifact.name}`);
	}
	throw new Error(`Could not find artifact: ${artifact_regex}`);
      }
      if (debug)
	console.log(`Found artifact ID: ${artifact_id}`);

      // Unzip the file
      const zipfile = await client.rest.actions.downloadArtifact({
	owner: owner,
	repo: repo,
	artifact_id: artifact_id,
	archive_format: "zip",
      });
      const zip = new AdmZip(Buffer.from(zipfile.data));
      zip.extractAllTo(extract_path, true /* overwrite */);

      // Ungzip the file
      const targzfilename = pathpkg.join(extract_path, `${tar_name}.tar.gz`);
      await tar.extract({
	file: targzfilename,
	C: extract_path
      });
      if (debug)
	console.log(`Extracted ${targzfilename}`);

      // Rename the directory to "bsc"
      const olddir = pathpkg.join(extract_path, tar_name);
      const newdir = pathpkg.join(extract_path, install_name);
      fs.renameSync(olddir, newdir);

      // Remove the temporary files
      fs.unlinkSync(targzfilename);
    }

    if (debug) {
      console.log("Files present in extract directory:");
      let files = fs.readdirSync(extract_path);
      files.forEach(file => {
	console.log(`  ${file}`);
      });
    }
    if (debug) {
      console.log("Files present in the 'bsc' directory:");
      let files = fs.readdirSync(pathpkg.join(extract_path, install_name));
      files.forEach(file => {
	console.log(`  ${file}`);
      });
      console.log("");
    }

    const bluetcl = pathpkg.join(extract_path, install_name, "bin", "bluetcl");
    const result = child_process.execSync(bluetcl, { input: "puts [::Bluetcl::version]" });
    const versioninfo = result.toString().split(" ");

    if ((! versioninfo) || (versioninfo.length != 2)) {
      throw new Error(`Unrecognized version info: ${versioninfo}`);
    }
    core.setOutput("tag", versioninfo[0]);
    core.setOutput("commit", versioninfo[1]);
    console.log("Outputs:");
    console.log(`  tag: ${versioninfo[0]}`);
    console.log(`  commit: ${versioninfo[1]}`);

  } catch (error) {
    core.setFailed(error.message);
  }
}

main();
