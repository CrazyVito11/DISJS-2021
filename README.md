# DISJS-2021
A simple application that scans a directory for duplicate images using NodeJS and ResembleJS.

## Developed and tested with
- NodeJS 12.17
- PhpStorm 2020.1.1

## How to install
The setup is really easy, you only have to install the node packages and then it's ready to go.
You can install the packages with this command:
```console
$ npm install
```

If you get any npm errors while it's compiling `node-canvas`, you might have to execute a couple more steps. 
Please check the [node-canvas](https://github.com/Automattic/node-canvas#compiling) repository for more information.

## How to use
The most basic way to use this application, is to just give it a path and run it.
```console
$ node main.js <path_goes_here>
```
This will work just fine, but there might be some settings you want to tweak to get the most out of this application.

### Threads
By default, the application will use **4** threads. This means it could use all of your PC or only a fraction of it, depending on your CPU.

You can get the fastest performance by using the same amount of threads your CPU has, at the cost of more RAM and less performance available for the rest of the system.
You can also choose to use fewer threads to keep more system resources available, at the cost of longer scanning times.

To set the amount of threads to use, add the `--threads=` parameter.
```console
$ node main.js /home/user/example --threads=8
```
In this example, we tell the application to scan the `/home/user/example` directory using 8 threads instead of the default 4.

### Threshold
TODO: Implement and document this feature

### Session recovery
TODO: Implement and document feature

- Put session file in the searching folder instead of project root
- On startup check if session file is available
- Remove session file when done scanning
- Make auto save timer adjustable

### Full size image scan
TODO: Implement thumbnail generation by default and document feature




### Mogelijke performance verbeteringen
- Alle afbeeldingen omzetten tot een thumbnail formaat en dumpen in hidden folder ofzo
- Hashes van alle afbeeldingen genereren van te voren *(zit er al in?)*
- Lijst van mogelijke combinaties van te voren maken, en die splitsen over de threads
- Uit die lijst items halen die al eerder zijn gescanned, of waarvan de hash matched