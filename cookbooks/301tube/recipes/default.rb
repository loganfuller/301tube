# Ensure apt cache is kept up to date
include_recipe "apt::default"

# Install required system libs
include_recipe "build-essential::default"

# Node.js
include_recipe "nodejs::default"

# Install project packages (executed on each boot)
bash "install-301tube-packages" do
    cwd "/usr/lib/node_modules/301tube"
    code "npm install && touch /tmp/.301tube-provisioned"
    not_if { ::File.exists?("/tmp/.301tube-provisioned") }
end
