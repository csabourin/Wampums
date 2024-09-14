{ pkgs }: {
	deps = [
   pkgs.php82Packages.composer
   pkgs.nodePackages.prettier
   pkgs.openssh
   pkgs.postgresql
		pkgs.php82
	];
}