# fmp_plugin_template
A full moon platform plugin template.

## Usage

Before using this mod template, make sure that you have installed Node.JS.

1. Generate a new repository from this template.
2. Clone the new repository into a local folder.
3. Download the full moon platform builder from github.com/231software/fullmoonplatform/releases , extract the zip file, and put `build` folder into the root of the repository.
4. Change the configration such as name, description, data path, plugin directory name, permission root in `plugin.json`.
5. Add your code.
6. Run `npm install` in the root of the repository to install necessary npm packages.
7. Run `npm run build` to build the plugin.

Now the build is complete at `dist`. If you want to change the build directory, change the `build_dir` config in `plugin.json`.
