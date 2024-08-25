{ pkgs }: {
	deps = [
   pkgs.nodePackages.prettier
   pkgs.openssh
   pkgs.postgresql
		pkgs.php82
	];
}