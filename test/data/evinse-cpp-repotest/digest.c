#include <openssl/evp.h>
#include <openssl/sha.h>
#include <stdio.h>
#include <string.h>

static void compute_digest(const unsigned char *payload, size_t len,
                           unsigned char *out) {
    EVP_MD_CTX *ctx = EVP_MD_CTX_new();
    EVP_DigestInit_ex(ctx, EVP_sha256(), NULL);
    EVP_DigestUpdate(ctx, payload, len);
    EVP_DigestFinal_ex(ctx, out, NULL);
    EVP_MD_CTX_free(ctx);
}

int process_record(const char *payload) {
    unsigned char digest[SHA256_DIGEST_LENGTH];
    compute_digest((const unsigned char *)payload, strlen(payload), digest);
    for (size_t i = 0; i < SHA256_DIGEST_LENGTH; i++) {
        printf("%02x", digest[i]);
    }
    printf("\n");
    return 0;
}
