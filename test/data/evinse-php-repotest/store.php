<?php

namespace EvinseFixture;

use function hash_hmac;
use function json_decode;

final class CredentialStore
{
    private array $records = [];

    public function store(string $key, string $payload): string
    {
        $digest = hash_hmac("sha256", $payload, $key);
        $decoded = json_decode($payload, true);
        $this->records[$digest] = $decoded;
        return $digest;
    }

    public function lookup(string $digest): mixed
    {
        return $this->records[$digest] ?? null;
    }
}
