plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

val generatedWebAssets = layout.buildDirectory.dir("generated/cityrailWebAssets")

tasks.register<Sync>("syncCityRailWeb") {
    val webRoot = layout.projectDirectory.dir("../..")
    into(generatedWebAssets)

    from(webRoot) {
        into("www")
        include("index.html")
        include("favicon.png")
        include("logo.jpeg")
        include("logo.png")
        include("logo.webp")
        include("og-image.webp")
        include("robots.txt")
        include("sitemap.xml")
        include("css/**")
        include("js/**")
        include("vendor/**")
        include("assets/**")
        exclude("assets/posters/**")
        exclude("**/.DS_Store")
    }

    from(layout.projectDirectory.dir("src/main/cityrail-android-overrides")) {
        into("www")
        include("**/*")
    }
}

android {
    namespace = "com.cityrail.simulator"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.cityrail.simulator"
        minSdk = 23
        targetSdk = 36
        versionCode = 1
        versionName = "1.0.0"
        vectorDrawables.useSupportLibrary = false

        manifestPlaceholders["cityrailChannel"] = "generic"
    }

    flavorDimensions += "store"
    productFlavors {
        create("generic") {
            dimension = "store"
            manifestPlaceholders["cityrailChannel"] = "generic"
        }
        create("huawei") {
            dimension = "store"
            manifestPlaceholders["cityrailChannel"] = "huawei"
        }
        create("oppo") {
            dimension = "store"
            manifestPlaceholders["cityrailChannel"] = "oppo"
        }
        create("vivo") {
            dimension = "store"
            manifestPlaceholders["cityrailChannel"] = "vivo"
        }
    }

    sourceSets["main"].assets.srcDir(generatedWebAssets)

    tasks.matching { it.name.startsWith("merge") && it.name.endsWith("Assets") }.configureEach {
        dependsOn("syncCityRailWeb")
    }
}
