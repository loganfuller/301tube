Vagrant.configure("2") do |config|
    config.vm.box = "trusty64"
    config.vm.box_url = "https://oss-binaries.phusionpassenger.com/vagrant/boxes/latest/ubuntu-14.04-amd64-vbox.box"
    config.vm.hostname = "local.301tube.com"
    config.vm.synced_folder "./", "/usr/local/lib/301tube"

    # Port forwarding
    config.vm.network :forwarded_port, guest: 8080, host: 8088, auto_correct: true # HTTP
    config.vm.network :forwarded_port, guest: 35729, host: 35729, auto_correct: true # Live reload
    config.vm.network :forwarded_port, guest: 8081, host: 8888, auto_correct: true # Node Inspector
    config.vm.network :forwarded_port, guest: 5858, host: 5858, auto_correct: true # Node Debugger
    config.vm.network :forwarded_port, guest: 27017, host: 27018, auto_correct: true # MongoDB
    config.vm.network :forwarded_port, guest: 6379, host: 6380, auto_correct: true # Redis

    # Chef config
    config.berkshelf.enabled = true
    config.omnibus.chef_version = "12.0.3"

    config.vm.provision "chef_solo" do |chef|
        chef.add_recipe "recipe[301tube]"
    end
end
